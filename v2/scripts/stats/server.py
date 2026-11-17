"""Local administration dashboard server for Nianlife access statistics.

Runs only on 127.0.0.1 (Windows localhost), reads data from local SQLite database,
and supports incremental sync from ECS via SSH.
"""

from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional

if __package__ is None or __package__ == '':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from db import get_connection, init_db, get_db_path
    from sync import sync_all_logs, DEFAULT_SSH_HOST, DEFAULT_SSH_KEY
    from geo import update_missing_geos
else:
    from .db import get_connection, init_db, get_db_path
    from .sync import sync_all_logs, DEFAULT_SSH_HOST, DEFAULT_SSH_KEY
    from .geo import update_missing_geos

CST = timezone(timedelta(hours=8))
DEFAULT_PORT = int(os.environ.get('PORT', 4000))
HOST = '127.0.0.1'


def get_beijing_today() -> str:
    return datetime.now(CST).strftime('%Y-%m-%d')


def resolve_date_range(range_type: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> tuple[str, str]:
    now_bj = datetime.now(CST)
    today = now_bj.strftime('%Y-%m-%d')

    if range_type == 'today':
        return today, today
    elif range_type == 'yesterday':
        yest = (now_bj - timedelta(days=1)).strftime('%Y-%m-%d')
        return yest, yest
    elif range_type == '7d':
        start = (now_bj - timedelta(days=6)).strftime('%Y-%m-%d')
        return start, today
    elif range_type == '30d':
        start = (now_bj - timedelta(days=29)).strftime('%Y-%m-%d')
        return start, today
    elif range_type == 'all':
        return '2026-10-01', '2099-12-31'
    elif range_type == 'custom':
        s = start_date if start_date else '2026-10-01'
        e = end_date if end_date else today
        return s, e
    return today, today


def build_where_clause(
    start_date: str,
    end_date: str,
    include_bot: str = '0',
    ip_filter: Optional[str] = None,
    path_filter: Optional[str] = None,
    device_filter: Optional[str] = None,
    only_pv: bool = True
) -> tuple[str, list]:
    conditions = ["date_bj >= ?", "date_bj <= ?"]
    params: list = [start_date, end_date]

    if include_bot == '0':
        conditions.append("is_bot = 0")
    elif include_bot == 'only':
        conditions.append("is_bot = 1")

    if only_pv:
        conditions.append("is_page_view = 1")

    if ip_filter and ip_filter.strip():
        conditions.append("ip = ?")
        params.append(ip_filter.strip())

    if path_filter and path_filter.strip():
        conditions.append("path LIKE ?")
        params.append(f"%{path_filter.strip()}%")

    if device_filter and device_filter.strip():
        conditions.append("device_type = ?")
        params.append(device_filter.strip())

    where_sql = " WHERE " + " AND ".join(conditions)
    return where_sql, params


def query_overview_stats(
    conn: sqlite3.Connection,
    range_type: str,
    start_date: Optional[str],
    end_date: Optional[str],
    include_bot: str = '0',
    ip_filter: Optional[str] = None
) -> Dict[str, Any]:
    s_date, e_date = resolve_date_range(range_type, start_date, end_date)
    cursor = conn.cursor()

    # 1. Summary metrics (PV, UV, Real Visitors)
    pv_where, pv_params = build_where_clause(s_date, e_date, include_bot, ip_filter, only_pv=True)
    cursor.execute(f"""
        SELECT 
            COUNT(*) as pv_count,
            COUNT(DISTINCT ip) as uv_count,
            SUM(CASE WHEN device_type IN ('mobile', 'tablet') THEN 1 ELSE 0 END) as mobile_pv,
            SUM(CASE WHEN is_wechat = 1 THEN 1 ELSE 0 END) as wechat_pv
        FROM access_logs
        {pv_where}
    """, pv_params)
    pv_row = cursor.fetchone()
    pv_count = pv_row['pv_count'] or 0
    uv_count = pv_row['uv_count'] or 0
    mobile_pv = pv_row['mobile_pv'] or 0
    wechat_pv = pv_row['wechat_pv'] or 0

    # Total requests & Bot requests
    all_where, all_params = build_where_clause(s_date, e_date, include_bot='1', ip_filter=ip_filter, only_pv=False)
    cursor.execute(f"""
        SELECT 
            COUNT(*) as total_reqs,
            SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_reqs
        FROM access_logs
        {all_where}
    """, all_params)
    all_row = cursor.fetchone()
    total_requests = all_row['total_reqs'] or 0
    bot_requests = all_row['bot_reqs'] or 0

    mobile_ratio = round((mobile_pv / pv_count * 100), 1) if pv_count > 0 else 0.0

    # 2. Daily trends
    cursor.execute(f"""
        SELECT 
            date_bj,
            COUNT(*) as pv,
            COUNT(DISTINCT ip) as uv
        FROM access_logs
        {pv_where}
        GROUP BY date_bj
        ORDER BY date_bj ASC
    """, pv_params)
    daily_trends = [{'date': r['date_bj'], 'pv': r['pv'], 'uv': r['uv']} for r in cursor.fetchall()]

    # 3. Hourly distribution (0 - 23)
    cursor.execute(f"""
        SELECT hour_bj, COUNT(*) as count
        FROM access_logs
        {pv_where}
        GROUP BY hour_bj
        ORDER BY hour_bj ASC
    """, pv_params)
    hourly_map = {r['hour_bj']: r['count'] for r in cursor.fetchall()}
    hourly_distribution = [hourly_map.get(h, 0) for h in range(24)]

    # 4. Device Distribution
    cursor.execute(f"""
        SELECT device_type, COUNT(*) as count
        FROM access_logs
        {pv_where}
        GROUP BY device_type
        ORDER BY count DESC
    """, pv_params)
    dev_name_map = {
        'mobile': '手机移动端',
        'desktop': '桌面电脑端',
        'tablet': '平板设备',
        'bot': '爬虫/机器人',
        'unknown': '未知设备 (历史日志未记UA)'
    }
    devices = [{
        'key': r['device_type'],
        'name': dev_name_map.get(r['device_type'], r['device_type']),
        'count': r['count'],
        'percent': round(r['count'] / pv_count * 100, 1) if pv_count > 0 else 0
    } for r in cursor.fetchall()]

    # 5. OS Distribution
    cursor.execute(f"""
        SELECT os, COUNT(*) as count
        FROM access_logs
        {pv_where}
        GROUP BY os
        ORDER BY count DESC
        LIMIT 8
    """, pv_params)
    os_list = [{'name': r['os'] or '未知', 'count': r['count']} for r in cursor.fetchall()]

    # 6. Browser Distribution
    cursor.execute(f"""
        SELECT browser, COUNT(*) as count
        FROM access_logs
        {pv_where}
        GROUP BY browser
        ORDER BY count DESC
        LIMIT 8
    """, pv_params)
    browsers = [{'name': r['browser'] or '未知', 'count': r['count']} for r in cursor.fetchall()]

    # 7. Top Pages
    cursor.execute(f"""
        SELECT 
            path,
            COUNT(*) as pv,
            COUNT(DISTINCT ip) as uv
        FROM access_logs
        {pv_where}
        GROUP BY path
        ORDER BY pv DESC
        LIMIT 20
    """, pv_params)
    top_pages = [{
        'path': r['path'],
        'pv': r['pv'],
        'uv': r['uv'],
        'percent': round(r['pv'] / pv_count * 100, 1) if pv_count > 0 else 0
    } for r in cursor.fetchall()]

    # 8. Top IPs with geo location
    cursor.execute(f"""
        SELECT 
            l.ip,
            l.is_masked,
            COUNT(*) as pv,
            MIN(l.time_bj) as first_seen,
            MAX(l.time_bj) as last_seen,
            COALESCE(g.location_label, '未知位置') as location_label,
            COALESCE(g.city, '') as city,
            COALESCE(g.isp, '') as isp
        FROM access_logs l
        LEFT JOIN ip_geo g ON l.ip = g.ip
        {pv_where.replace('date_bj', 'l.date_bj').replace('is_bot', 'l.is_bot').replace('is_page_view', 'l.is_page_view').replace('ip =', 'l.ip =')}
        GROUP BY l.ip
        ORDER BY pv DESC
        LIMIT 25
    """, pv_params)
    top_ips = [{
        'ip': r['ip'],
        'is_masked': bool(r['is_masked']),
        'pv': r['pv'],
        'location_label': r['location_label'],
        'city': r['city'],
        'isp': r['isp'],
        'first_seen': r['first_seen'],
        'last_seen': r['last_seen']
    } for r in cursor.fetchall()]

    return {
        'date_range': {'start': s_date, 'end': e_date, 'type': range_type},
        'summary': {
            'pv': pv_count,
            'uv': uv_count,
            'total_requests': total_requests,
            'bot_requests': bot_requests,
            'mobile_ratio': mobile_ratio,
            'wechat_pv': wechat_pv
        },
        'daily_trends': daily_trends,
        'hourly_distribution': hourly_distribution,
        'devices': devices,
        'os_list': os_list,
        'browsers': browsers,
        'top_pages': top_pages,
        'top_ips': top_ips
    }


def query_log_records(
    conn: sqlite3.Connection,
    range_type: str,
    start_date: Optional[str],
    end_date: Optional[str],
    page: int = 1,
    page_size: int = 50,
    ip_filter: Optional[str] = None,
    path_filter: Optional[str] = None,
    device_filter: Optional[str] = None,
    only_pv: bool = True,
    include_bot: str = '0',
    search: Optional[str] = None
) -> Dict[str, Any]:
    s_date, e_date = resolve_date_range(range_type, start_date, end_date)
    cursor = conn.cursor()

    conditions = ["l.date_bj >= ?", "l.date_bj <= ?"]
    params: list = [s_date, end_date if end_date else e_date]

    if include_bot == '0':
        conditions.append("l.is_bot = 0")
    elif include_bot == 'only':
        conditions.append("l.is_bot = 1")

    if only_pv:
        conditions.append("l.is_page_view = 1")

    if ip_filter and ip_filter.strip():
        conditions.append("l.ip = ?")
        params.append(ip_filter.strip())

    if path_filter and path_filter.strip():
        conditions.append("l.path LIKE ?")
        params.append(f"%{path_filter.strip()}%")

    if device_filter and device_filter.strip():
        conditions.append("l.device_type = ?")
        params.append(device_filter.strip())

    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append("(l.ip LIKE ? OR l.path LIKE ? OR g.location_label LIKE ? OR l.user_agent LIKE ?)")
        params.extend([term, term, term, term])

    where_sql = " WHERE " + " AND ".join(conditions)

    # Count total
    cursor.execute(f"""
        SELECT COUNT(*) 
        FROM access_logs l
        LEFT JOIN ip_geo g ON l.ip = g.ip
        {where_sql}
    """, params)
    total_count = cursor.fetchone()[0]

    offset = max(0, (page - 1) * page_size)
    cursor.execute(f"""
        SELECT 
            l.id, l.time_bj, l.ip, l.is_masked, l.path, l.method,
            l.status, l.duration, l.size, l.device_type, l.os, l.browser,
            l.is_wechat, l.is_bot, l.is_page_view, l.page_view_type,
            COALESCE(g.location_label, '未知位置') as location_label
        FROM access_logs l
        LEFT JOIN ip_geo g ON l.ip = g.ip
        {where_sql}
        ORDER BY l.ts DESC
        LIMIT ? OFFSET ?
    """, params + [page_size, offset])

    rows = cursor.fetchall()
    logs = [dict(r) for r in rows]

    total_pages = (total_count + page_size - 1) // page_size if page_size > 0 else 1

    return {
        'total': total_count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'logs': logs
    }


def query_ip_detail(conn: sqlite3.Connection, ip: str, range_type: str, start_date: Optional[str], end_date: Optional[str]) -> Dict[str, Any]:
    s_date, e_date = resolve_date_range(range_type, start_date, end_date)
    cursor = conn.cursor()

    # Geo info
    cursor.execute("SELECT * FROM ip_geo WHERE ip = ?", (ip,))
    geo_row = cursor.fetchone()
    geo = dict(geo_row) if geo_row else {'ip': ip, 'location_label': '未知位置'}

    # Summary for this IP
    cursor.execute("""
        SELECT 
            COUNT(*) as total_requests,
            SUM(CASE WHEN is_page_view = 1 THEN 1 ELSE 0 END) as pv_count,
            MIN(time_bj) as first_seen,
            MAX(time_bj) as last_seen,
            GROUP_CONCAT(DISTINCT browser) as browsers,
            GROUP_CONCAT(DISTINCT device_type) as devices,
            MAX(is_masked) as is_masked
        FROM access_logs
        WHERE ip = ? AND date_bj >= ? AND date_bj <= ?
    """, (ip, s_date, e_date))
    stat = dict(cursor.fetchone())

    # Pages visited by this IP
    cursor.execute("""
        SELECT 
            path,
            COUNT(*) as count,
            MAX(time_bj) as last_visited
        FROM access_logs
        WHERE ip = ? AND date_bj >= ? AND date_bj <= ? AND is_page_view = 1
        GROUP BY path
        ORDER BY count DESC
        LIMIT 20
    """, (ip, s_date, e_date))
    pages = [dict(r) for r in cursor.fetchall()]

    return {
        'ip': ip,
        'geo': geo,
        'stat': stat,
        'pages': pages
    }


class StatsHandler(BaseHTTPRequestHandler):
    sync_lock = threading.Lock()

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        def param(key: str, default: Optional[str] = None) -> Optional[str]:
            vals = qs.get(key)
            return vals[0] if vals else default

        try:
            conn = get_connection()
            init_db(conn)

            if path == '/' or path == '/index.html':
                self.serve_html_dashboard()
            elif path == '/api/stats/overview':
                res = query_overview_stats(
                    conn,
                    range_type=param('range', '7d'),
                    start_date=param('start_date'),
                    end_date=param('end_date'),
                    include_bot=param('include_bot', '0'),
                    ip_filter=param('ip')
                )
                self.serve_json(res)
            elif path == '/api/stats/logs':
                res = query_log_records(
                    conn,
                    range_type=param('range', '7d'),
                    start_date=param('start_date'),
                    end_date=param('end_date'),
                    page=int(param('page', '1')),
                    page_size=int(param('page_size', '50')),
                    ip_filter=param('ip'),
                    path_filter=param('path'),
                    device_filter=param('device'),
                    only_pv=param('only_pv', '1') == '1',
                    include_bot=param('include_bot', '0'),
                    search=param('search')
                )
                self.serve_json(res)
            elif path == '/api/stats/ip':
                target_ip = param('ip')
                if not target_ip:
                    self.serve_json({'error': 'Missing ip'}, 400)
                    return
                res = query_ip_detail(
                    conn,
                    ip=target_ip,
                    range_type=param('range', '7d'),
                    start_date=param('start_date'),
                    end_date=param('end_date')
                )
                self.serve_json(res)
            elif path == '/api/stats/status':
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*), MIN(time_bj), MAX(time_bj) FROM access_logs")
                count, min_time, max_time = cursor.fetchone()
                cursor.execute("SELECT value FROM sync_state WHERE key = 'last_sync_time'")
                sync_row = cursor.fetchone()
                last_sync = sync_row[0] if sync_row else '未同步'
                self.serve_json({
                    'total_records': count,
                    'earliest_record': min_time,
                    'latest_record': max_time,
                    'last_sync_time': last_sync,
                    'server_time': datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S'),
                    'db_path': get_db_path()
                })
            else:
                self.send_error(404, "Not Found")
            conn.close()
        except Exception as e:
            self.serve_json({'error': str(e)}, 500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/stats/sync':
            if not self.sync_lock.acquire(blocking=False):
                self.serve_json({'status': 'busy', 'message': '正在同步中，请稍候'}, 429)
                return
            try:
                res = sync_all_logs()
                self.serve_json(res)
            except Exception as e:
                self.serve_json({'status': 'error', 'message': str(e)}, 500)
            finally:
                self.sync_lock.release()
        elif path == '/api/stats/resolve-geos':
            try:
                conn = get_connection()
                init_db(conn)
                resolved = update_missing_geos(conn)
                conn.close()
                self.serve_json({'status': 'ok', 'resolved': resolved})
            except Exception as e:
                self.serve_json({'status': 'error', 'message': str(e)}, 500)
        else:
            self.send_error(404, "Not Found")

    def serve_json(self, data: Any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def serve_html_dashboard(self):
        html = DASHBOARD_HTML.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(html)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(html)


DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nianlife 访问统计 - 本地管理后台</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-border: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --badge-bg: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding-bottom: 60px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Layout */
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--surface-border);
      padding: 16px 24px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand h1 {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.5px;
      color: #fff;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      background: var(--badge-bg);
      color: var(--text-muted);
    }
    .badge-success { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge-accent { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    button, .btn {
      background: var(--accent);
      color: #0f172a;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    button:hover, .btn:hover { background: var(--accent-hover); color: #fff; text-decoration: none; }
    button.secondary {
      background: var(--surface-border);
      color: var(--text-main);
    }
    button.secondary:hover { background: #475569; }

    .container {
      max-width: 1360px;
      margin: 24px auto;
      padding: 0 20px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Explanation Banner */
    .notice-card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid var(--surface-border);
      border-left: 4px solid var(--warning);
      padding: 14px 18px;
      border-radius: 8px;
      font-size: 13px;
      color: #cbd5e1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .notice-card strong { color: #fde68a; }

    /* Filter Toolbar */
    .toolbar {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 14px 18px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .filter-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      background: #0f172a;
      border: 1px solid var(--surface-border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .pill:hover { border-color: var(--accent); color: #fff; }
    .pill.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    input, select {
      background: #0f172a;
      border: 1px solid var(--surface-border);
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }
    input:focus, select:focus { border-color: var(--accent); }

    /* Summary Cards */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .metric-card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
    }
    .metric-title {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .metric-sub {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Charts Section */
    .charts-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
    }
    @media (max-width: 960px) {
      .charts-grid { grid-template-columns: 1fr; }
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Trend Bar Chart */
    .trend-container {
      height: 180px;
      display: flex;
      align-items: flex-end;
      gap: 6px;
      padding-top: 20px;
      border-bottom: 1px solid var(--surface-border);
      overflow-x: auto;
    }
    .bar-group {
      flex: 1;
      min-width: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      height: 100%;
      justify-content: flex-end;
      position: relative;
    }
    .bar-group:hover .bar-tooltip { display: block; }
    .bar-pv {
      width: 14px;
      background: var(--accent);
      border-radius: 3px 3px 0 0;
      transition: height 0.3s ease;
    }
    .bar-uv {
      width: 14px;
      background: #a855f7;
      border-radius: 3px 3px 0 0;
      transition: height 0.3s ease;
    }
    .bar-label {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      margin-top: 6px;
    }
    .bar-tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      border: 1px solid var(--surface-border);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }

    /* Distribution Progress Bars */
    .dist-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
    }
    .dist-header {
      display: flex;
      justify-content: space-between;
      color: #e2e8f0;
    }
    .progress-bar-bg {
      height: 8px;
      background: #0f172a;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 4px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th {
      background: #0f172a;
      color: var(--text-muted);
      font-weight: 500;
      padding: 10px 14px;
      border-bottom: 1px solid var(--surface-border);
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.4);
      color: #cbd5e1;
    }
    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }
    .ip-link {
      color: var(--accent);
      cursor: pointer;
      font-family: ui-monospace, monospace;
      font-weight: 600;
    }
    .ip-link:hover { text-decoration: underline; }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .modal-content {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      max-width: 760px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--surface-border);
      padding-bottom: 12px;
    }
    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 20px;
      cursor: pointer;
      padding: 4px;
    }
    .close-btn:hover { color: #fff; background: none; }

    /* Pagination */
    .pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 14px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .page-btns {
      display: flex;
      gap: 6px;
    }

    .tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .tag-wechat { background: #07c160; color: #fff; }
    .tag-desktop { background: #3b82f6; color: #fff; }
    .tag-mobile { background: #ec4899; color: #fff; }
    .tag-tablet { background: #8b5cf6; color: #fff; }
    .tag-bot { background: #64748b; color: #fff; }
    .tag-masked { background: #475569; color: #cbd5e1; }
    .tag-real { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
  </style>
</head>
<body>

  <header class="header">
    <div class="brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20V10"/>
        <path d="M18 20V4"/>
        <path d="M6 20v-4"/>
      </svg>
      <h1>Nianlife 访问统计</h1>
      <span class="badge badge-success">● 本地后台 127.0.0.1</span>
      <span id="syncStatusBadge" class="badge">检查同步状态...</span>
    </div>
    <div class="header-actions">
      <button id="syncBtn" onclick="triggerSync()">
        <span>🔄</span> 增量同步线上数据
      </button>
    </div>
  </header>

  <main class="container">

    <!-- Notice Card -->
    <div class="notice-card">
      <div>
        <strong>📌 统计口径说明与数据说明：</strong>
        独立 IP 数（UV）<strong>不等于实际人数，也不等于设备数</strong>。家庭/单位 Wi-Fi 共享同一出口公网 IP；移动网络基站切换会造成同一手机 IP 变动；同一手机可能在微信与 Safari 中分别访问。
      </div>
      <div style="font-size: 12px; color: #94a3b8;">
        • <strong>历史数据覆盖</strong>：2026-10-12 至 2026-11-17 期间线上 Caddy 按 /16 掩码打码并抹除了 User-Agent，历史数据如实展示打码 IP 与未知设备，不作虚构编造。<br>
        • <strong>新版全量记录</strong>：2026-11-17 22:54:33 升级线上采集配置生效，开始记录完整 IP、精确时间（秒）与完整 User-Agent（解析操作系统、浏览器及微信内置标识）。<br>
        • <strong>精确计数</strong>：自动剔除静态文件、图片视频媒体、Next.js Prefetch 预取、健康探针及漏洞探测；支持单页路由 (SPA) 客户端跳转；已识别网络爬虫单独归类。
      </div>
    </div>

    <!-- Active IP Filter Banner -->
    <div id="activeIpBanner" style="display: none; background: rgba(56, 189, 248, 0.15); border: 1px solid var(--accent); padding: 10px 16px; border-radius: 8px; justify-content: space-between; align-items: center;">
      <span style="font-size: 13px; color: #e0f2fe;">
        🔍 当前正对 IP 进行下钻过滤：<strong id="filteredIpText" style="color: var(--accent);"></strong>
      </span>
      <button class="secondary" style="padding: 4px 10px; font-size: 12px;" onclick="clearIpFilter()">✕ 清除 IP 筛选</button>
    </div>

    <!-- Toolbar Filters -->
    <div class="toolbar">
      <div class="filter-group">
        <span style="font-size: 13px; color: var(--text-muted); font-weight: 500;">时间跨度:</span>
        <div class="pill" data-range="today" onclick="setRange('today')">今日</div>
        <div class="pill" data-range="yesterday" onclick="setRange('yesterday')">昨日</div>
        <div class="pill active" data-range="7d" onclick="setRange('7d')">近 7 天</div>
        <div class="pill" data-range="30d" onclick="setRange('30d')">近 30 天</div>
        <div class="pill" data-range="all" onclick="setRange('all')">全部历史</div>
        <div class="pill" data-range="custom" onclick="setRange('custom')">自定义</div>
        <div id="customDateInputs" style="display: none; align-items: center; gap: 6px;">
          <input type="date" id="startDateInput" onchange="applyCustomDates()">
          <span style="color: var(--text-muted);">-</span>
          <input type="date" id="endDateInput" onchange="applyCustomDates()">
        </div>
      </div>

      <div class="filter-group">
        <span style="font-size: 13px; color: var(--text-muted); font-weight: 500;">访客筛选:</span>
        <select id="botFilterSelect" onchange="applyBotFilter()">
          <option value="0">排除网络爬虫 (仅看真实访问)</option>
          <option value="1">包含全部访问 (含爬虫探测)</option>
          <option value="only">仅看网络爬虫 / 探测</option>
        </select>
      </div>
    </div>

    <!-- Summary Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-title">
          <span>页面浏览量 (PV)</span>
          <span>📄</span>
        </div>
        <div class="metric-value" id="valPV">-</div>
        <div class="metric-sub" id="subPV">已排除静态文件与预取</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">
          <span>独立访问 IP (UV)</span>
          <span>🌐</span>
        </div>
        <div class="metric-value" id="valUV">-</div>
        <div class="metric-sub">不同公网 IP 数 (≠人数)</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">
          <span>移动端 / 微信访问</span>
          <span>📱</span>
        </div>
        <div class="metric-value" id="valMobileRatio">-</div>
        <div class="metric-sub" id="subWechat">微信内置浏览器: - 次</div>
      </div>

      <div class="metric-card">
        <div class="metric-title">
          <span>爬虫 / 探测拦截</span>
          <span>🛡️</span>
        </div>
        <div class="metric-value" id="valBotReqs">-</div>
        <div class="metric-sub" id="subTotalReqs">总原始 HTTP 请求: -</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="card">
        <div class="card-title">
          <span>每日访问趋势 (PV & UV)</span>
          <div style="display: flex; gap: 12px; font-size: 12px; font-weight: normal;">
            <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--accent); border-radius: 2px;"></span> PV 浏览量</span>
            <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: #a855f7; border-radius: 2px;"></span> UV 独立 IP</span>
          </div>
        </div>
        <div class="trend-container" id="trendChart">
          <div style="margin: auto; color: var(--text-muted); font-size: 13px;">加载中...</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>访问设备分布</span>
        </div>
        <div id="deviceDistList" style="display: flex; flex-direction: column; gap: 14px; padding-top: 8px;">
          <div style="color: var(--text-muted); font-size: 13px;">加载中...</div>
        </div>
      </div>
    </div>

    <!-- Top Tables (Pages & IPs) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 16px;">
      <!-- Top Pages -->
      <div class="card">
        <div class="card-title">
          <span>热门访问页面 Top 15</span>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>页面路径</th>
                <th style="width: 80px; text-align: right;">浏览量 (PV)</th>
                <th style="width: 80px; text-align: right;">独立 IP (UV)</th>
              </tr>
            </thead>
            <tbody id="topPagesBody">
              <tr><td colspan="3" style="text-align: center; color: var(--text-muted);">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top IPs -->
      <div class="card">
        <div class="card-title">
          <span>高频访问 IP 与归属地 Top 15</span>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>访问 IP (点击筛选)</th>
                <th>归属地城市与网络</th>
                <th style="width: 70px; text-align: right;">PV 频次</th>
                <th style="width: 130px;">最后访问时间</th>
              </tr>
            </thead>
            <tbody id="topIpsBody">
              <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Access Logs Detail Table -->
    <div class="card">
      <div class="card-title">
        <span>访问明细表</span>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="text" id="logSearchInput" placeholder="搜索 IP / 路径 / 城市..." style="width: 220px;" onkeydown="if(event.key==='Enter') applyLogFilter()">
          <button class="secondary" style="padding: 6px 12px; font-size: 13px;" onclick="applyLogFilter()">搜索</button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th style="width: 155px;">访问时间 (北京时间)</th>
              <th style="width: 140px;">来源 IP</th>
              <th>地理位置与城市</th>
              <th>访问页面</th>
              <th>设备 / 操作系统 / 浏览器</th>
              <th style="width: 70px; text-align: center;">状态</th>
              <th style="width: 70px; text-align: right;">耗时</th>
            </tr>
          </thead>
          <tbody id="logsTableBody">
            <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">加载明细中...</td></tr>
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <span id="paginationInfo">第 1 页</span>
        <div class="page-btns">
          <button class="secondary" id="prevPageBtn" onclick="changePage(-1)">上一页</button>
          <button class="secondary" id="nextPageBtn" onclick="changePage(1)">下一页</button>
        </div>
      </div>
    </div>

  </main>

  <!-- IP Detail Modal -->
  <div id="ipModal" class="modal-backdrop" onclick="if(event.target===this) closeIpModal()">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modalIpTitle" style="font-size: 18px; color: #fff;">IP 档案</h3>
        <button class="close-btn" onclick="closeIpModal()">✕</button>
      </div>
      <div id="modalIpBody" style="display: flex; flex-direction: column; gap: 16px;">
        加载中...
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
        <button class="secondary" onclick="filterThisIpFromModal()">在主表中筛选此 IP</button>
        <button onclick="closeIpModal()">关闭</button>
      </div>
    </div>
  </div>

  <script>
    let currentRange = '7d';
    let customStart = '';
    let customEnd = '';
    let currentBotFilter = '0';
    let filteredIp = '';
    let logPage = 1;
    let logPageSize = 50;
    let totalLogPages = 1;

    async function init() {
      checkSyncStatus();
      await loadOverview();
      await loadLogs();
    }

    async function checkSyncStatus() {
      try {
        const res = await fetch('/api/stats/status');
        const data = await res.json();
        const badge = document.getElementById('syncStatusBadge');
        badge.textContent = `本地记录: ${data.total_records.toLocaleString()} 条 (最新: ${data.last_sync_time})`;
      } catch (e) {
        console.error(e);
      }
    }

    async function triggerSync() {
      const btn = document.getElementById('syncBtn');
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> 同步中...';
      try {
        const res = await fetch('/api/stats/sync', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'ok') {
          alert(`同步完成！耗时 ${data.duration_seconds} 秒，本地现有记录 ${data.total_db_records.toLocaleString()} 条。`);
          checkSyncStatus();
          loadOverview();
          loadLogs();
        } else {
          alert(`同步提示: ${data.message || '未知错误'}`);
        }
      } catch (err) {
        alert('同步失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }

    function setRange(range) {
      currentRange = range;
      document.querySelectorAll('.filter-group .pill').forEach(el => {
        el.classList.toggle('active', el.dataset.range === range);
      });
      const customInputs = document.getElementById('customDateInputs');
      if (range === 'custom') {
        customInputs.style.display = 'inline-flex';
      } else {
        customInputs.style.display = 'none';
        loadOverview();
        logPage = 1;
        loadLogs();
      }
    }

    function applyCustomDates() {
      customStart = document.getElementById('startDateInput').value;
      customEnd = document.getElementById('endDateInput').value;
      if (customStart && customEnd) {
        loadOverview();
        logPage = 1;
        loadLogs();
      }
    }

    function applyBotFilter() {
      currentBotFilter = document.getElementById('botFilterSelect').value;
      loadOverview();
      logPage = 1;
      loadLogs();
    }

    function selectIp(ip) {
      filteredIp = ip;
      document.getElementById('activeIpBanner').style.display = 'flex';
      document.getElementById('filteredIpText').textContent = ip;
      loadOverview();
      logPage = 1;
      loadLogs();
    }

    function clearIpFilter() {
      filteredIp = '';
      document.getElementById('activeIpBanner').style.display = 'none';
      loadOverview();
      logPage = 1;
      loadLogs();
    }

    function buildQueryParams() {
      const p = new URLSearchParams();
      p.set('range', currentRange);
      if (currentRange === 'custom') {
        if (customStart) p.set('start_date', customStart);
        if (customEnd) p.set('end_date', customEnd);
      }
      p.set('include_bot', currentBotFilter);
      if (filteredIp) p.set('ip', filteredIp);
      return p;
    }

    async function loadOverview() {
      const p = buildQueryParams();
      try {
        const res = await fetch(`/api/stats/overview?${p.toString()}`);
        const data = await res.json();
        renderSummary(data.summary);
        renderTrendChart(data.daily_trends);
        renderDevices(data.devices, data.browsers);
        renderTopPages(data.top_pages);
        renderTopIps(data.top_ips);
      } catch (err) {
        console.error('loadOverview error:', err);
      }
    }

    function renderSummary(summary) {
      document.getElementById('valPV').textContent = summary.pv.toLocaleString();
      document.getElementById('valUV').textContent = summary.uv.toLocaleString();
      document.getElementById('valMobileRatio').textContent = summary.mobile_ratio + '%';
      document.getElementById('subWechat').textContent = `微信内置浏览器: ${summary.wechat_pv.toLocaleString()} 次`;
      document.getElementById('valBotReqs').textContent = summary.bot_requests.toLocaleString();
      document.getElementById('subTotalReqs').textContent = `总原始 HTTP 请求: ${summary.total_requests.toLocaleString()}`;
    }

    function renderTrendChart(trends) {
      const container = document.getElementById('trendChart');
      if (!trends || trends.length === 0) {
        container.innerHTML = '<div style="margin: auto; color: var(--text-muted); font-size: 13px;">所选时间段暂无访问记录</div>';
        return;
      }
      const maxVal = Math.max(...trends.map(t => Math.max(t.pv, t.uv)), 10);
      container.innerHTML = trends.map(t => {
        const pvH = Math.max(4, (t.pv / maxVal) * 140);
        const uvH = Math.max(4, (t.uv / maxVal) * 140);
        const dateStr = t.date.slice(5);
        return `
          <div class="bar-group">
            <div class="bar-tooltip">
              <strong>${t.date}</strong><br>
              页面浏览 (PV): ${t.pv}<br>
              独立 IP (UV): ${t.uv}
            </div>
            <div style="display: flex; gap: 2px; align-items: flex-end;">
              <div class="bar-pv" style="height: ${pvH}px;"></div>
              <div class="bar-uv" style="height: ${uvH}px;"></div>
            </div>
            <div class="bar-label">${dateStr}</div>
          </div>
        `;
      }).join('');
    }

    function renderDevices(devices, browsers) {
      const container = document.getElementById('deviceDistList');
      if (!devices || devices.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">暂无设备数据</div>';
        return;
      }
      let html = devices.map(d => `
        <div class="dist-row">
          <div class="dist-header">
            <span>${d.name}</span>
            <span style="font-weight: 600;">${d.count} 次 (${d.percent}%)</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${d.percent}%;"></div>
          </div>
        </div>
      `).join('');

      if (browsers && browsers.length > 0) {
        html += `<div style="margin-top: 14px; font-size: 12px; color: var(--text-muted); border-top: 1px solid var(--surface-border); padding-top: 10px;">
          <strong>主流浏览器分布：</strong> ` + browsers.map(b => `${b.name} (${b.count})`).join(' · ') + `</div>`;
      }
      container.innerHTML = html;
    }

    function renderTopPages(pages) {
      const tbody = document.getElementById('topPagesBody');
      if (!pages || pages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">暂无记录</td></tr>';
        return;
      }
      tbody.innerHTML = pages.map(p => `
        <tr>
          <td><span style="font-family: monospace; font-weight: 500; color: #f1f5f9;">${escapeHtml(p.path)}</span></td>
          <td style="text-align: right; font-weight: 600; color: var(--accent);">${p.pv}</td>
          <td style="text-align: right; color: #cbd5e1;">${p.uv}</td>
        </tr>
      `).join('');
    }

    function renderTopIps(ips) {
      const tbody = document.getElementById('topIpsBody');
      if (!ips || ips.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">暂无记录</td></tr>';
        return;
      }
      tbody.innerHTML = ips.map(item => {
        const badge = item.is_masked 
          ? '<span class="tag tag-masked" title="2026-10-12至2026-11-17历史日志IP打码">历史打码</span>' 
          : '<span class="tag tag-real" title="新版采集记录的完整IP">完整IP</span>';
        return `
          <tr>
            <td>
              <span class="ip-link" onclick="openIpModal('${item.ip}')">${item.ip}</span>
              ${badge}
            </td>
            <td><span style="color: #e2e8f0;">${escapeHtml(item.location_label)}</span></td>
            <td style="text-align: right; font-weight: 600; color: #fff;">${item.pv}</td>
            <td style="font-size: 12px; color: var(--text-muted);">${item.last_seen || '-'}</td>
          </tr>
        `;
      }).join('');
    }

    async function loadLogs() {
      const p = buildQueryParams();
      p.set('page', logPage);
      p.set('page_size', logPageSize);
      const search = document.getElementById('logSearchInput').value.trim();
      if (search) p.set('search', search);

      const tbody = document.getElementById('logsTableBody');
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">加载明细中...</td></tr>';

      try {
        const res = await fetch(`/api/stats/logs?${p.toString()}`);
        const data = await res.json();
        totalLogPages = data.total_pages || 1;
        document.getElementById('paginationInfo').textContent = `第 ${data.page} / ${totalLogPages} 页 (共 ${data.total.toLocaleString()} 条)`;
        document.getElementById('prevPageBtn').disabled = (data.page <= 1);
        document.getElementById('nextPageBtn').disabled = (data.page >= totalLogPages);

        if (!data.logs || data.logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">没有符合条件的访问记录</td></tr>';
          return;
        }

        tbody.innerHTML = data.logs.map(r => {
          let devBadge = `<span class="tag tag-${r.device_type}">${r.device_type}</span>`;
          let wechatBadge = r.is_wechat ? '<span class="tag tag-wechat">微信</span>' : '';
          let navBadge = r.page_view_type === 'client_nav' ? '<span class="tag" style="background:#334155; font-size:10px;">单页跳转</span>' : '';
          let ipBadge = r.is_masked ? '<span class="tag tag-masked">打码</span>' : '';

          let statusColor = r.status >= 400 ? 'var(--danger)' : (r.status >= 300 ? 'var(--warning)' : 'var(--success)');

          return `
            <tr>
              <td style="font-size: 12px; font-family: monospace;">${r.time_bj}</td>
              <td>
                <span class="ip-link" onclick="openIpModal('${r.ip}')">${r.ip}</span>
                ${ipBadge}
              </td>
              <td><span style="font-size: 12px;">${escapeHtml(r.location_label)}</span></td>
              <td>
                <span style="font-family: monospace; color: #f8fafc;">${escapeHtml(r.path)}</span>
                ${navBadge}
              </td>
              <td>
                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                  ${devBadge}
                  ${wechatBadge}
                  <span style="font-size: 12px; color: #cbd5e1;">${escapeHtml(r.os)} / ${escapeHtml(r.browser)}</span>
                </div>
              </td>
              <td style="text-align: center;"><span style="color: ${statusColor}; font-weight: 600; font-family: monospace;">${r.status}</span></td>
              <td style="text-align: right; font-size: 12px; color: var(--text-muted); font-family: monospace;">${(r.duration * 1000).toFixed(0)}ms</td>
            </tr>
          `;
        }).join('');
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger);">加载失败: ${err.message}</td></tr>`;
      }
    }

    function applyLogFilter() {
      logPage = 1;
      loadLogs();
    }

    function changePage(delta) {
      const next = logPage + delta;
      if (next >= 1 && next <= totalLogPages) {
        logPage = next;
        loadLogs();
      }
    }

    let activeModalIp = '';
    async function openIpModal(ip) {
      activeModalIp = ip;
      document.getElementById('modalIpTitle').textContent = `IP 访问档案: ${ip}`;
      document.getElementById('modalIpBody').innerHTML = '加载 IP 明细中...';
      document.getElementById('ipModal').style.display = 'flex';

      try {
        const p = buildQueryParams();
        p.set('ip', ip);
        const res = await fetch(`/api/stats/ip?${p.toString()}`);
        const data = await res.json();
        renderIpModal(data);
      } catch (err) {
        document.getElementById('modalIpBody').innerHTML = '加载失败: ' + err.message;
      }
    }

    function renderIpModal(data) {
      const geo = data.geo || {};
      const stat = data.stat || {};
      const pages = data.pages || [];

      document.getElementById('modalIpBody').innerHTML = `
        <div style="background: #0f172a; padding: 14px; border-radius: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
          <div><strong>IP 地址:</strong> <span style="font-family: monospace; color: var(--accent);">${data.ip}</span> ${stat.is_masked ? '(历史打码 /16)' : '(完整公网 IP)'}</div>
          <div><strong>归属城市与位置:</strong> ${escapeHtml(geo.location_label || '未知')}</div>
          <div><strong>国家与地区:</strong> ${geo.country || '-'} ${geo.region || ''} ${geo.city || ''}</div>
          <div><strong>网络运营商 (ISP):</strong> ${geo.isp || '-'}</div>
          <div><strong>在选定范围内访问量:</strong> PV ${stat.pv_count || 0} 次 / 请求总数 ${stat.total_requests || 0}</div>
          <div><strong>访问时间跨度:</strong> ${stat.first_seen || '-'} 至 ${stat.last_seen || '-'}</div>
          <div style="grid-column: span 2;"><strong>识别到的设备与浏览器:</strong> ${escapeHtml(stat.devices || '-')} · ${escapeHtml(stat.browsers || '-')}</div>
        </div>

        <div>
          <h4 style="font-size: 14px; margin-bottom: 8px; color: #fff;">该 IP 访问过的页面路径：</h4>
          <table style="background: #0f172a; border-radius: 6px; overflow: hidden;">
            <thead>
              <tr>
                <th>页面路径</th>
                <th style="width: 80px; text-align: right;">浏览次数</th>
                <th style="width: 140px;">最后一次访问</th>
              </tr>
            </thead>
            <tbody>
              ${pages.length === 0 ? '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">暂无页面浏览</td></tr>' : pages.map(p => `
                <tr>
                  <td style="font-family: monospace;">${escapeHtml(p.path)}</td>
                  <td style="text-align: right; color: var(--accent); font-weight: 600;">${p.count}</td>
                  <td style="font-size: 12px; color: var(--text-muted);">${p.last_visited}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    function closeIpModal() {
      document.getElementById('ipModal').style.display = 'none';
    }

    function filterThisIpFromModal() {
      if (activeModalIp) {
        closeIpModal();
        selectIp(activeModalIp);
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.onload = init;
  </script>
</body>
</html>
"""


def run_server(port: int = DEFAULT_PORT):
    server_address = (HOST, port)
    httpd = HTTPServer(server_address, StatsHandler)
    print(f"=" * 60)
    print(f" Nianlife 访问统计后台已启动！")
    print(f" 本地私密访问地址: http://{HOST}:{port}")
    print(f" 数据存储位置: {get_db_path()}")
    print(f" 按 Ctrl+C 可停止服务")
    print(f"=" * 60)
    httpd.serve_forever()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else DEFAULT_PORT
    run_server(port)
