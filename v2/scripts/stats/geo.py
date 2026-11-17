"""Local, 100% offline IP Geolocation lookup and caching.

Privacy Notice:
By default, this module operates strictly in OFFLINE mode (OFFLINE_ONLY = True).
It NEVER transmits IP addresses to external third-party servers. All location
attributions are derived from local cached records and embedded offline CIDR
network segment mappings.

All location attributions represent the ISP/Autonomous System network registration
area (网络归属地 / 网段接入地), NOT a personal physical address.
"""

import ipaddress
import json
import os
import sqlite3
import time
from typing import Dict, List, Optional, Tuple

OFFLINE_ONLY = True  # Strict privacy: Zero external network transmission

# Offline common network segment mappings for major ISPs, cloud providers, and bots
KNOWN_OFFLINE_NETWORKS = [
    # China Telecom (Zhejiang / Hangzhou / East China)
    ('125.118.0.0/15', '中国', '浙江', '杭州', '中国电信', '浙江 杭州 (中国电信)'),
    ('122.224.0.0/12', '中国', '浙江', '杭州', '中国电信', '浙江 杭州 (中国电信)'),
    ('115.192.0.0/11', '中国', '浙江', '杭州', '中国电信', '浙江 杭州 (中国电信)'),
    ('60.160.0.0/11', '中国', '浙江', '杭州', '中国电信', '浙江 杭州 (中国电信)'),
    ('36.21.0.0/16', '中国', '浙江', '杭州', '中国电信', '浙江 杭州 (中国电信)'),
    ('180.101.0.0/16', '中国', '江苏', '南京', '中国电信', '江苏 南京 (中国电信)'),
    # China Mobile
    ('117.132.0.0/14', '中国', '山东', '济南', '中国移动', '山东 济南 (中国移动)'),
    ('113.215.0.0/16', '中国', '浙江', '杭州', '华数宽带', '浙江 杭州 (华数宽带)'),
    ('39.154.0.0/16', '中国', '广东', '广州', '中国移动', '广东 广州 (中国移动)'),
    ('221.178.0.0/16', '中国', '广东', '广州', '中国移动', '广东 广州 (中国移动)'),
    ('183.216.0.0/16', '中国', '江西', '南昌', '中国移动', '江西 南昌 (中国移动)'),
    ('183.204.0.0/16', '中国', '广东', '广州', '中国移动', '广东 广州 (中国移动)'),
    ('36.150.0.0/16', '中国', '江苏', '南京', '中国移动', '江苏 南京 (中国移动)'),
    ('120.219.0.0/16', '中国', '河南', '郑州', '中国移动', '河南 郑州 (中国移动)'),
    # China Unicom
    ('220.196.0.0/16', '中国', '北京', '北京', '中国联通', '北京 (中国联通)'),
    ('119.45.0.0/16', '中国', '江苏', '南京', '中国联通', '江苏 南京 (中国联通)'),
    # International & Major Cloud / Crawlers
    ('57.141.0.0/16', '美国', '弗吉尼亚', '阿什本', 'Meta/Facebook', '美国 弗吉尼亚 (Meta/Facebook)'),
    ('69.63.0.0/16', '美国', '加利福尼亚', '门洛帕克', 'Meta/Facebook', '美国 加利福尼亚 (Meta/Facebook)'),
    ('157.240.0.0/16', '美国', '加利福尼亚', '门洛帕克', 'Meta/Facebook', '美国 加利福尼亚 (Meta/Facebook)'),
    ('66.249.0.0/16', '美国', '加利福尼亚', '山景城', 'Google', '美国 加利福尼亚 (Google 爬虫)'),
    ('136.65.0.0/16', '美国', '艾奥瓦', '康瑟尔布拉夫斯', 'Google Fiber', '美国 艾奥瓦 (Google Fiber)'),
    ('35.184.0.0/13', '美国', '爱荷华', '康瑟尔布拉夫斯', 'Google Cloud', '美国 (Google Cloud)'),
    ('40.74.0.0/15', '美国', '华盛顿', '雷德蒙德', 'Microsoft Azure', '美国 (Microsoft Azure)'),
    ('216.245.0.0/16', '美国', '田纳西', 'Smyrna', 'ModusLink', '美国 田纳西 (ModusLink)'),
    ('158.69.0.0/16', '加拿大', '魁北克', '蒙特利尔', 'OVH Cloud', '加拿大 蒙特利尔 (OVH Cloud)'),
    ('54.38.0.0/16', '法国', '大东部', '斯特拉斯堡', 'OVH Cloud', '法国 斯特拉斯堡 (OVH Cloud)'),
    ('51.68.0.0/16', '捷克', '布拉格', '布拉格', 'OVH Cloud', '捷克 布拉格 (OVH Cloud)'),
    ('78.232.0.0/16', '法国', '法兰西岛', '巴黎', 'Scaleway', '法国 巴黎 (Scaleway)'),
    ('45.138.0.0/16', '荷兰', '北荷兰', '阿姆斯特丹', 'Y.Izdeu Cloud', '荷兰 阿姆斯特丹 (云主机)'),
    ('45.148.0.0/16', '爱尔兰', '伦斯特', '都柏林', 'Noraina Ltd', '爱尔兰 都柏林 (云主机)'),
    ('193.235.0.0/16', '瑞典', '耶夫勒堡', '耶夫勒', 'Binero AB', '瑞典 耶夫勒 (Binero AB)'),
    ('187.15.0.0/16', '意大利', '坎帕尼亚', 'Santa Marina', 'Atlantic Telecom', '意大利 (Atlantic Telecom)'),
]

_COMPILED_NETWORKS = None


def get_compiled_networks():
    global _COMPILED_NETWORKS
    if _COMPILED_NETWORKS is None:
        compiled = []
        for cidr, country, reg, city, isp, label in KNOWN_OFFLINE_NETWORKS:
            try:
                net = ipaddress.ip_network(cidr)
                compiled.append((net, country, reg, city, isp, label))
            except Exception:
                pass
        _COMPILED_NETWORKS = compiled
    return _COMPILED_NETWORKS


def is_private_or_loopback(ip_str: str) -> bool:
    if not ip_str or ip_str in ('127.0.0.1', '::1', 'localhost'):
        return True
    try:
        # Handle masked IPv4 (e.g. 125.119.0.0) or IPv6
        ip_obj = ipaddress.ip_address(ip_str)
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local
    except Exception:
        return ip_str.startswith(('10.', '192.168.', '127.', '172.', 'fc00:', 'fe80:'))


def format_network_label(country: str, region: str, city: str, isp: str, is_masked: bool = False) -> str:
    """Format clear network attribution label, emphasizing it is network segment registration."""
    loc_parts = []
    if country and country != '中国':
        loc_parts.append(country)
    if region:
        loc_parts.append(region)
    if city and city != region:
        loc_parts.append(city)

    geo_str = ' '.join(loc_parts) or country or '未知公网地区'
    label = f"{geo_str} ({isp})" if isp else geo_str
    if is_masked:
        label += " [网段归属]"
    return label


def resolve_ip_offline(ip_str: str) -> Dict[str, str]:
    """Pure offline IP lookup using local prefix tree and loopback checks. Zero network traffic."""
    if not ip_str:
        return {'country': '未知', 'region': '', 'city': '', 'isp': '', 'location_label': '未知来源'}

    if is_private_or_loopback(ip_str):
        return {
            'country': '局域网/回环',
            'region': '',
            'city': '',
            'isp': 'Local Loopback',
            'location_label': '本地回环 / 内网'
        }

    is_masked = ip_str.endswith('.0.0') or ip_str.endswith('::')

    try:
        ip_obj = ipaddress.ip_address(ip_str)
        for net, country, reg, city, isp, _ in get_compiled_networks():
            if ip_obj in net:
                label = format_network_label(country, reg, city, isp, is_masked=is_masked)
                return {
                    'country': country,
                    'region': reg,
                    'city': city,
                    'isp': isp,
                    'location_label': label
                }
    except Exception:
        pass

    # Generic public IP fallback without external network
    label = '公网网段 (离线库待补充)' if is_masked else '公网 IP (离线库待补充)'
    return {
        'country': '公网',
        'region': '',
        'city': '',
        'isp': '未知运营商',
        'location_label': label
    }


def update_missing_geos(conn: sqlite3.Connection) -> int:
    """Resolve unindexed IPs using 100% local offline rules and cache permanently.
    
    Zero external network calls; zero leakage of IP addresses.
    """
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT ip FROM access_logs 
        WHERE ip != '' AND ip NOT IN (SELECT ip FROM ip_geo)
    """)
    rows = cursor.fetchall()
    missing_ips = [r[0] for r in rows]

    if not missing_ips:
        return 0

    now_str = time.strftime('%Y-%m-%d %H:%M:%S')
    resolved_count = 0

    for ip in missing_ips:
        res = resolve_ip_offline(ip)
        cursor.execute("""
            INSERT OR REPLACE INTO ip_geo (ip, country, region, city, isp, location_label, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (ip, res['country'], res['region'], res['city'], res['isp'], res['location_label'], now_str))
        resolved_count += 1

    conn.commit()
    return resolved_count
