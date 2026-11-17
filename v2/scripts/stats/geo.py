"""IP Geolocation lookup and local caching."""

import json
import sqlite3
import time
import urllib.error
import urllib.request
from typing import Dict, List, Optional


def is_private_or_loopback(ip: str) -> bool:
    if not ip or ip in ('127.0.0.1', '::1', 'localhost'):
        return True
    if ip.startswith(('10.', '192.168.', 'fc00:', 'fe80:')):
        return True
    if ip.startswith('172.'):
        parts = ip.split('.')
        if len(parts) >= 2 and parts[1].isdigit() and 16 <= int(parts[1]) <= 31:
            return True
    return False


def build_location_label(country: str, region: str, city: str, isp: str) -> str:
    """Format a clear, readable Chinese location string."""
    loc_parts = []
    if country and country != '中国':
        loc_parts.append(country)
    if region:
        loc_parts.append(region)
    if city and city != region:
        loc_parts.append(city)
    
    geo_str = ' '.join(loc_parts) or country or '未知地区'
    if isp:
        return f"{geo_str} ({isp})"
    return geo_str


def batch_resolve_ips(ips: List[str], timeout: int = 8) -> List[Dict[str, str]]:
    """Query ip-api.com batch endpoint with zh-CN language."""
    if not ips:
        return []

    url = 'http://ip-api.com/batch?lang=zh-CN'
    payload = json.dumps([{'query': ip} for ip in ips]).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json', 'User-Agent': 'NianlifeStats/1.0'}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            results = []
            for item in data:
                ip = item.get('query', '')
                if item.get('status') == 'success':
                    country = item.get('country', '')
                    region = item.get('regionName', '')
                    city = item.get('city', '')
                    isp = item.get('isp', '')
                    label = build_location_label(country, region, city, isp)
                    results.append({
                        'ip': ip,
                        'country': country,
                        'region': region,
                        'city': city,
                        'isp': isp,
                        'location_label': label
                    })
                else:
                    results.append({
                        'ip': ip,
                        'country': '未知',
                        'region': '未知',
                        'city': '未知',
                        'isp': '',
                        'location_label': '未知位置'
                    })
            return results
    except Exception as e:
        # Fallback for network issues
        return [{
            'ip': ip,
            'country': '未知',
            'region': '未知',
            'city': '未知',
            'isp': '',
            'location_label': '查询超时'
        } for ip in ips]


def update_missing_geos(conn: sqlite3.Connection, batch_size: int = 100) -> int:
    """Find all IPs without geo records and resolve them in batches."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT ip FROM access_logs 
        WHERE ip != '' AND ip NOT IN (SELECT ip FROM ip_geo)
    """)
    rows = cursor.fetchall()
    missing_ips = [r[0] for r in rows]

    if not missing_ips:
        return 0

    total_resolved = 0
    now_str = time.strftime('%Y-%m-%d %H:%M:%S')

    # Handle private / loopback directly
    public_ips = []
    for ip in missing_ips:
        if is_private_or_loopback(ip):
            cursor.execute("""
                INSERT OR REPLACE INTO ip_geo (ip, country, region, city, isp, location_label, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (ip, '局域网/回环', '', '', 'Local', '本地回环 / 内网', now_str))
            total_resolved += 1
        else:
            public_ips.append(ip)

    # Chunk public IPs in batches of 100
    for i in range(0, len(public_ips), batch_size):
        chunk = public_ips[i:i + batch_size]
        geo_results = batch_resolve_ips(chunk)
        for res in geo_results:
            cursor.execute("""
                INSERT OR REPLACE INTO ip_geo (ip, country, region, city, isp, location_label, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                res['ip'],
                res['country'],
                res['region'],
                res['city'],
                res['isp'],
                res['location_label'],
                now_str
            ))
            total_resolved += 1
        conn.commit()
        # Be polite to the free API rate limit (max 15 requests per minute for unauthenticated)
        if i + batch_size < len(public_ips):
            time.sleep(1.5)

    conn.commit()
    return total_resolved
