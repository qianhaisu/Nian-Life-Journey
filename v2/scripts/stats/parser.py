"""Access log parsing, device detection, and page view classification."""

from datetime import datetime, timezone, timedelta
import hashlib
from typing import Any, Dict, Optional, Tuple

CST = timezone(timedelta(hours=8))

BOT_KEYWORDS = (
    'bot', 'spider', 'crawl', 'slurp', 'mediapartners', 'feedfetcher',
    'facebookexternalhit', 'googlebot', 'baiduspider', 'bingbot',
    'bytespider', 'sogou', 'yandex', 'duckduckbot', 'headless',
    'curl', 'python', 'wget', 'httpclient', 'go-http', 'java', 'postman'
)

SCANNER_EXTENSIONS = (
    '.env', '.php', '.bak', '.yml', '.yaml', '.git', '.sql', '.tar',
    '.gz', '.zip', '.config', '.action', '.ini', '.asp', '.aspx', '.jsp'
)

ASSET_EXTENSIONS = (
    '.js', '.css', '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.mp4', '.webm', '.mov', '.mp3', '.wav', '.map', '.txt',
    '.xml', '.json'
)

STATIC_PREFIXES = (
    '/_next/', '/fonts/', '/media/', '/images/', '/favicon.ico',
    '/icon', '/apple-icon', '/manifest.webmanifest', '/robots.txt',
    '/sitemap.xml', '/site.webmanifest'
)

SENSITIVE_QUERY_KEYS = (
    'token', 'auth', 'key', 'secret', 'password', 'pwd', 'code',
    'ticket', 'session', 'phone', 'mobile', 'email', 'openid',
    'sign', 'signature', 'pass', 'api_key', 'apikey'
)


def sanitize_uri(uri: str) -> str:
    """Sanitize sensitive query parameter values in URI, replacing values with [REDACTED]."""
    if not uri or '?' not in uri:
        return uri
    try:
        import urllib.parse
        base, qs = uri.split('?', 1)
        params = urllib.parse.parse_qsl(qs, keep_blank_values=True)
        sanitized = []
        for k, v in params:
            k_lower = k.lower()
            if any(s in k_lower for s in SENSITIVE_QUERY_KEYS):
                sanitized.append((k, '[REDACTED]'))
            else:
                sanitized.append((k, v))
        return f"{base}?{urllib.parse.urlencode(sanitized)}"
    except Exception:
        return uri.split('?')[0]


def parse_device_and_ua(ua_str: Optional[str]) -> Dict[str, Any]:
    """Parse User-Agent string without fabricating specific phone models."""
    if not ua_str or not ua_str.strip():
        return {
            'device_type': 'unknown',
            'os': '未知',
            'browser': '未知',
            'is_wechat': 0,
            'is_bot': 0,
            'summary': '未知 (历史日志未记录 UA)'
        }

    ua = ua_str.strip()
    ua_l = ua.lower()

    # 1. Bot identification
    known_bots = {
        'googlebot': ('Bot', 'Googlebot 爬虫'),
        'baiduspider': ('Bot', '百度爬虫'),
        'bingbot': ('Bot', 'Bing 爬虫'),
        'bytespider': ('Bot', '字节跳动/头条爬虫'),
        'yandex': ('Bot', 'Yandex 爬虫'),
        'sogou': ('Bot', '搜狗爬虫'),
        'duckduckbot': ('Bot', 'DuckDuckGo 爬虫'),
        'curl': ('CLI', 'curl 命令行工具'),
        'python': ('Script', 'Python 脚本'),
        'wget': ('CLI', 'wget 工具'),
        'postman': ('Client', 'Postman 测试'),
        'go-http': ('Script', 'Go HTTP 客户端'),
        'headless': ('Bot', 'Headless 自动化浏览器'),
    }

    for key, (bot_os, bot_browser) in known_bots.items():
        if key in ua_l:
            return {
                'device_type': 'bot',
                'os': bot_os,
                'browser': bot_browser,
                'is_wechat': 0,
                'is_bot': 1,
                'summary': f'机器人 ({bot_browser})'
            }

    if any(k in ua_l for k in ('bot', 'spider', 'crawl', 'crawler')):
        return {
            'device_type': 'bot',
            'os': 'Bot',
            'browser': '网络爬虫',
            'is_wechat': 0,
            'is_bot': 1,
            'summary': '机器人 / 爬虫'
        }

    # 2. WeChat in-app browser
    is_wechat = 1 if 'micromessenger' in ua_l else 0

    # 3. Operating System
    os_name = '未知'
    if 'windows nt 10.0' in ua_l or 'windows nt 11.0' in ua_l or 'windows nt' in ua_l:
        os_name = 'Windows'
    elif 'iphone' in ua_l:
        os_name = 'iOS'
    elif 'ipad' in ua_l:
        os_name = 'iPadOS'
    elif 'macintosh' in ua_l or 'mac os x' in ua_l:
        os_name = 'macOS'
    elif 'android' in ua_l:
        os_name = 'Android'
    elif 'linux' in ua_l:
        os_name = 'Linux'

    # 4. Device Type
    device_type = 'desktop'
    if 'ipad' in ua_l or 'tablet' in ua_l:
        device_type = 'tablet'
    elif 'iphone' in ua_l or 'android' in ua_l or 'mobile' in ua_l:
        device_type = 'mobile'
    elif is_wechat:
        device_type = 'mobile'
    elif os_name in ('Windows', 'macOS', 'Linux'):
        device_type = 'desktop'
    else:
        device_type = 'unknown'

    # 5. Browser identification
    browser_name = '未知'
    if is_wechat:
        browser_name = '微信内置浏览器'
    elif 'edg/' in ua_l or 'edge/' in ua_l:
        browser_name = 'Edge'
    elif 'chrome/' in ua_l or 'crios/' in ua_l:
        browser_name = 'Chrome'
    elif 'safari/' in ua_l and not ('chrome' in ua_l or 'android' in ua_l):
        browser_name = 'Safari'
    elif 'firefox/' in ua_l:
        browser_name = 'Firefox'
    elif 'opera/' in ua_l or 'opr/' in ua_l:
        browser_name = 'Opera'

    dev_label = {
        'mobile': '手机',
        'desktop': '电脑',
        'tablet': '平板',
        'bot': '机器人',
        'unknown': '未知'
    }.get(device_type, '未知')

    summary = f"{dev_label} ({os_name} / {browser_name})"
    return {
        'device_type': device_type,
        'os': os_name,
        'browser': browser_name,
        'is_wechat': is_wechat,
        'is_bot': 0,
        'summary': summary
    }


def clean_page_path(uri: str) -> str:
    """Normalize page URI to standard path."""
    path = uri.split('?')[0].rstrip('/')
    if not path:
        return '/'
    return path


def is_ip_masked(ip: str) -> int:
    """Detect if IP was masked by /16 (IPv4) or /32 (IPv6)."""
    if not ip:
        return 0
    if ip.endswith('.0.0'):
        return 1
    if '::' in ip and ip.endswith('::'):
        return 1
    return 0


def parse_log_line(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse one Caddy access log entry into a structured record."""
    ts = data.get('ts')
    if ts is None:
        return None

    dt = datetime.fromtimestamp(ts, CST)
    time_bj = dt.strftime('%Y-%m-%d %H:%M:%S')
    date_bj = dt.strftime('%Y-%m-%d')
    hour_bj = dt.hour

    req = data.get('request', {})
    remote_ip = req.get('client_ip') or req.get('remote_ip') or ''
    method = req.get('method', 'GET').upper()
    uri = req.get('uri', '/')
    status = data.get('status', 0)
    duration = data.get('duration', 0.0)
    size = data.get('size', 0)
    headers = req.get('headers', {})

    # Extract User-Agent
    ua_list = headers.get('User-Agent') or headers.get('user-agent') or []
    ua_str = ua_list[0] if isinstance(ua_list, list) and ua_list else (ua_list if isinstance(ua_list, str) else '')

    dev_info = parse_device_and_ua(ua_str)
    raw_path = clean_page_path(uri)
    is_masked = is_ip_masked(remote_ip)

    # 1. Scanner probe detection
    is_scanner = False
    uri_lower = uri.lower()
    if any(raw_path.endswith(ext) or ext in uri_lower for ext in SCANNER_EXTENSIONS):
        is_scanner = True
    if '/wp-' in uri_lower or '/actuator' in uri_lower or '/solr' in uri_lower or '/.git' in uri_lower:
        is_scanner = True

    is_bot = dev_info['is_bot'] or (1 if is_scanner else 0)

    # 2. Static asset detection
    is_static = False
    if any(raw_path.endswith(ext) for ext in ASSET_EXTENSIONS):
        is_static = True
    if any(raw_path.startswith(prefix) for prefix in STATIC_PREFIXES):
        is_static = True

    # 3. API / Health check routes
    is_api = raw_path.startswith('/api/') or raw_path in ('/healthz', '/ping')

    # 4. Next.js Prefetch detection
    is_prefetch = False
    pref_header = headers.get('Next-Router-Prefetch') or []
    purpose_header = headers.get('Purpose') or []
    sec_purpose_header = headers.get('Sec-Purpose') or []
    if '1' in pref_header:
        is_prefetch = True
    if any('prefetch' in str(x).lower() for x in purpose_header + sec_purpose_header):
        is_prefetch = True

    # 5. Page View Classification
    # HEAD requests are explicitly excluded: HEAD fetches headers only without a page body,
    # and is used by crawlers, uptime monitors, or curl probes — never human page viewing.
    is_page_view = 0
    page_view_type = 'none'
    final_path = raw_path

    if (status in (200, 304, 206) and 
        method == 'GET' and 
        not is_static and 
        not is_api and 
        not is_prefetch and 
        not is_scanner and
        dev_info['device_type'] != 'bot'):

        sec_dest = (headers.get('Sec-Fetch-Dest') or [''])[0].lower()
        sec_mode = (headers.get('Sec-Fetch-Mode') or [''])[0].lower()
        accept = (headers.get('Accept') or [''])[0].lower()
        is_rsc = ('1' in (headers.get('Rsc') or [])) or ('_rsc=' in uri)
        next_url = (headers.get('Next-Url') or [''])[0]

        if sec_dest == 'document' or sec_mode == 'navigate' or 'text/html' in accept:
            is_page_view = 1
            page_view_type = 'document'
        elif is_rsc:
            # SPA client-side route navigation
            is_page_view = 1
            page_view_type = 'client_nav'
            if next_url:
                final_path = clean_page_path(next_url)
        elif not sec_dest and not is_rsc:
            # Fallback for browsers or historical requests without Sec-Fetch headers
            is_page_view = 1
            page_view_type = 'document'

    # Sanitize sensitive query parameters from raw URI before recording
    sanitized_uri = sanitize_uri(uri)

    # Compute deterministic request hash for idempotency and deduplication
    hash_seed = f"{ts:.6f}_{remote_ip}_{method}_{uri}_{status}_{ua_str}"
    request_hash = hashlib.sha256(hash_seed.encode('utf-8')).hexdigest()

    return {
        'request_hash': request_hash,
        'ts': ts,
        'time_bj': time_bj,
        'date_bj': date_bj,
        'hour_bj': hour_bj,
        'ip': remote_ip,
        'is_masked': is_masked,
        'method': method,
        'uri': sanitized_uri,
        'path': final_path,
        'status': status,
        'duration': duration,
        'size': size,
        'user_agent': ua_str,
        'device_type': dev_info['device_type'],
        'os': dev_info['os'],
        'browser': dev_info['browser'],
        'is_wechat': dev_info['is_wechat'],
        'is_bot': is_bot,
        'is_page_view': is_page_view,
        'page_view_type': page_view_type
    }
