"""Incremental log synchronization from ECS to local SQLite database."""

import gzip
import json
import os
import subprocess
import time
from typing import Any, Dict, List, Optional

if __package__ is None or __package__ == '':
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from db import get_connection, init_db
    from geo import update_missing_geos
    from parser import parse_log_line
else:
    from .db import get_connection, init_db
    from .geo import update_missing_geos
    from .parser import parse_log_line

DEFAULT_SSH_HOST = os.environ.get('ECS_SSH', 'ecs-user@47.99.243.155')
DEFAULT_SSH_KEY = os.environ.get(
    'ECS_KEY',
    os.path.expanduser(r'C:\Users\teddy\.ssh\nianlife-prod-ecs.pem')
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
LOG_CACHE_DIR = os.path.join(REPO_ROOT, 'v2', '.data', 'access-logs')


def ensure_dirs():
    os.makedirs(LOG_CACHE_DIR, exist_ok=True)


def run_ssh_command(cmd: str, ssh_host: str = DEFAULT_SSH_HOST, ssh_key: str = DEFAULT_SSH_KEY) -> str:
    """Execute a remote command on ECS via SSH."""
    args = [
        'ssh',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-i', ssh_key,
        ssh_host,
        cmd
    ]
    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    return proc.stdout


def fetch_remote_file_list(ssh_host: str = DEFAULT_SSH_HOST, ssh_key: str = DEFAULT_SSH_KEY) -> List[str]:
    """List access log files in Caddy container."""
    cmd = "docker exec nianlife-caddy ls -1 /data/log"
    out = run_ssh_command(cmd, ssh_host, ssh_key)
    return [f.strip() for f in out.splitlines() if f.strip().startswith('access')]


def download_gz_file(filename: str, ssh_host: str = DEFAULT_SSH_HOST, ssh_key: str = DEFAULT_SSH_KEY) -> str:
    """Download a rotated gzip log file to local cache using ssh pipe."""
    ensure_dirs()
    dest_path = os.path.join(LOG_CACHE_DIR, filename)
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return dest_path

    cmd = f"docker exec nianlife-caddy cat /data/log/{filename}"
    args = [
        'ssh',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=15',
        '-i', ssh_key,
        ssh_host,
        cmd
    ]
    with open(dest_path, 'wb') as f:
        subprocess.run(args, stdout=f, check=True)
    return dest_path


def insert_parsed_records(conn, records: List[Dict[str, Any]]) -> int:
    """Batch insert parsed records with IGNORE on duplicate request_hash."""
    if not records:
        return 0

    sql = """
    INSERT OR IGNORE INTO access_logs (
        request_hash, ts, time_bj, date_bj, hour_bj, ip, is_masked,
        method, uri, path, status, duration, size, user_agent,
        device_type, os, browser, is_wechat, is_bot, is_page_view, page_view_type
    ) VALUES (
        :request_hash, :ts, :time_bj, :date_bj, :hour_bj, :ip, :is_masked,
        :method, :uri, :path, :status, :duration, :size, :user_agent,
        :device_type, :os, :browser, :is_wechat, :is_bot, :is_page_view, :page_view_type
    )
    """
    cursor = conn.cursor()
    cursor.executemany(sql, records)
    conn.commit()
    return cursor.rowcount


def sync_all_logs(ssh_host: str = DEFAULT_SSH_HOST, ssh_key: str = DEFAULT_SSH_KEY) -> Dict[str, Any]:
    """Execute complete incremental synchronization."""
    start_time = time.time()
    ensure_dirs()
    conn = get_connection()
    init_db(conn)

    cursor = conn.cursor()
    # Check max existing timestamp
    cursor.execute("SELECT MAX(ts) FROM access_logs")
    row = cursor.fetchone()
    last_max_ts = row[0] if (row and row[0] is not None) else 0.0

    remote_files = fetch_remote_file_list(ssh_host, ssh_key)
    gz_files = sorted([f for f in remote_files if f.endswith('.gz')])
    has_active_log = 'access.log' in remote_files

    total_inserted = 0
    synced_gz_count = 0

    # 1. Process rotated .gz files (only if not already completed)
    for gz_name in gz_files:
        cursor.execute("SELECT value FROM sync_state WHERE key = ?", (f"gz_done:{gz_name}",))
        state = cursor.fetchone()
        if state and state[0] == '1':
            continue

        local_path = download_gz_file(gz_name, ssh_host, ssh_key)
        records = []
        with gzip.open(local_path, 'rt', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    rec = parse_log_line(data)
                    if rec:
                        records.append(rec)
                except Exception:
                    continue
                if len(records) >= 5000:
                    insert_parsed_records(conn, records)
                    records.clear()

        if records:
            insert_parsed_records(conn, records)

        cursor.execute("""
            INSERT OR REPLACE INTO sync_state (key, value, updated_at)
            VALUES (?, '1', datetime('now'))
        """, (f"gz_done:{gz_name}",))
        conn.commit()
        synced_gz_count += 1

    # 2. Process active access.log incrementally
    new_active_records = []
    if has_active_log:
        # Stream lines from ECS access.log
        # Only lines with ts > last_max_ts if last_max_ts > 0
        if last_max_ts > 0:
            cmd = f"""docker exec nianlife-caddy cat /data/log/access.log | python3 -c '
import json, sys
min_ts = {last_max_ts}
for line in sys.stdin:
    try:
        d = json.loads(line)
        if d.get("ts", 0) > min_ts:
            sys.stdout.write(line)
    except Exception:
        pass
'"""
        else:
            cmd = "docker exec nianlife-caddy cat /data/log/access.log"

        out = run_ssh_command(cmd, ssh_host, ssh_key)
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                rec = parse_log_line(data)
                if rec:
                    new_active_records.append(rec)
            except Exception:
                continue
            if len(new_active_records) >= 5000:
                insert_parsed_records(conn, new_active_records)
                new_active_records.clear()

        if new_active_records:
            insert_parsed_records(conn, new_active_records)

    # 3. Query new max timestamp and record sync status
    cursor.execute("SELECT MAX(ts), COUNT(*) FROM access_logs")
    max_ts_after, total_count = cursor.fetchone()
    now_str = time.strftime('%Y-%m-%d %H:%M:%S')

    cursor.execute("""
        INSERT OR REPLACE INTO sync_state (key, value, updated_at)
        VALUES ('last_sync_time', ?, ?)
    """, (now_str, now_str))
    conn.commit()

    # 4. Resolve missing IP geolocations
    geos_resolved = update_missing_geos(conn)

    duration = time.time() - start_time
    conn.close()

    return {
        'status': 'ok',
        'synced_gz_files': synced_gz_count,
        'total_db_records': total_count,
        'latest_ts': max_ts_after,
        'geos_resolved': geos_resolved,
        'duration_seconds': round(duration, 2),
        'synced_at': now_str
    }


if __name__ == '__main__':
    print("Starting sync from ECS...")
    result = sync_all_logs()
    print("Sync complete:", json.dumps(result, ensure_ascii=False, indent=2))
