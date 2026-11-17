"""Database schema and query utilities for Nianlife local stats."""

import os
import sqlite3
from typing import Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Repo root is two levels up from v2/scripts/stats
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
V2_DATA_DIR = os.path.join(REPO_ROOT, 'v2', '.data')
DB_PATH = os.path.join(V2_DATA_DIR, 'stats.db')


def get_db_path() -> str:
    os.makedirs(V2_DATA_DIR, exist_ok=True)
    return DB_PATH


def get_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    conn = sqlite3.connect(path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.executescript("""
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_hash TEXT UNIQUE,
        ts REAL,
        time_bj TEXT,
        date_bj TEXT,
        hour_bj INTEGER,
        ip TEXT,
        is_masked INTEGER DEFAULT 0,
        method TEXT,
        uri TEXT,
        path TEXT,
        status INTEGER,
        duration REAL,
        size INTEGER,
        user_agent TEXT,
        device_type TEXT,
        os TEXT,
        browser TEXT,
        is_wechat INTEGER DEFAULT 0,
        is_bot INTEGER DEFAULT 0,
        is_page_view INTEGER DEFAULT 0,
        page_view_type TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_ts ON access_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON access_logs(date_bj);
    CREATE INDEX IF NOT EXISTS idx_logs_ip ON access_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_logs_path ON access_logs(path);
    CREATE INDEX IF NOT EXISTS idx_logs_pv ON access_logs(is_page_view, date_bj);
    CREATE INDEX IF NOT EXISTS idx_logs_bot ON access_logs(is_bot);

    CREATE TABLE IF NOT EXISTS ip_geo (
        ip TEXT PRIMARY KEY,
        country TEXT,
        region TEXT,
        city TEXT,
        isp TEXT,
        location_label TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
    );
    """)
    conn.commit()
