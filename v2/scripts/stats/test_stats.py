"""Unit tests for Nianlife access log statistics."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parser import parse_device_and_ua, parse_log_line, clean_page_path, is_ip_masked
from geo import build_location_label, is_private_or_loopback


class TestStatsParser(unittest.TestCase):

    def test_wechat_ua_detection(self):
        ua_iphone = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48"
        )
        res = parse_device_and_ua(ua_iphone)
        self.assertEqual(res['device_type'], 'mobile')
        self.assertEqual(res['os'], 'iOS')
        self.assertEqual(res['browser'], '微信内置浏览器')
        self.assertEqual(res['is_wechat'], 1)
        self.assertEqual(res['is_bot'], 0)

    def test_desktop_chrome_ua(self):
        ua_pc = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        res = parse_device_and_ua(ua_pc)
        self.assertEqual(res['device_type'], 'desktop')
        self.assertEqual(res['os'], 'Windows')
        self.assertEqual(res['browser'], 'Chrome')
        self.assertEqual(res['is_wechat'], 0)
        self.assertEqual(res['is_bot'], 0)

    def test_ipad_safari_ua(self):
        ua_ipad = (
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        res = parse_device_and_ua(ua_ipad)
        self.assertEqual(res['device_type'], 'tablet')
        self.assertEqual(res['os'], 'iPadOS')
        self.assertEqual(res['browser'], 'Safari')

    def test_bot_ua(self):
        ua_bot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        res = parse_device_and_ua(ua_bot)
        self.assertEqual(res['device_type'], 'bot')
        self.assertEqual(res['is_bot'], 1)

    def test_missing_ua(self):
        res = parse_device_and_ua(None)
        self.assertEqual(res['device_type'], 'unknown')
        self.assertEqual(res['os'], '未知')
        self.assertEqual(res['browser'], '未知')
        self.assertIn('历史日志未记录 UA', res['summary'])

    def test_ip_mask_detection(self):
        self.assertEqual(is_ip_masked("125.119.0.0"), 1)
        self.assertEqual(is_ip_masked("240e:47c:3000::"), 1)
        self.assertEqual(is_ip_masked("125.119.85.238"), 0)
        self.assertEqual(is_ip_masked("240e:47c:3000:1234::1"), 0)

    def test_clean_path(self):
        self.assertEqual(clean_page_path("/films/xueyi?variant=web"), "/films/xueyi")
        self.assertEqual(clean_page_path("/travel/"), "/travel")
        self.assertEqual(clean_page_path("/"), "/")

    def test_static_asset_exclusion(self):
        entry = {
            "ts": 1794927277.0,
            "status": 200,
            "request": {
                "remote_ip": "125.119.85.238",
                "method": "GET",
                "uri": "/_next/static/chunks/app/page.js",
                "headers": {"Accept": ["*/*"]}
            }
        }
        rec = parse_log_line(entry)
        self.assertIsNotNone(rec)
        self.assertEqual(rec['is_page_view'], 0)

    def test_prefetch_exclusion(self):
        entry = {
            "ts": 1794927277.0,
            "status": 200,
            "request": {
                "remote_ip": "125.119.85.238",
                "method": "GET",
                "uri": "/travel?_rsc=abc",
                "headers": {
                    "Next-Router-Prefetch": ["1"],
                    "Rsc": ["1"]
                }
            }
        }
        rec = parse_log_line(entry)
        self.assertIsNotNone(rec)
        self.assertEqual(rec['is_page_view'], 0)

    def test_client_nav_page_view(self):
        entry = {
            "ts": 1794927277.0,
            "status": 200,
            "request": {
                "remote_ip": "125.119.85.238",
                "method": "GET",
                "uri": "/?_rsc=xyz",
                "headers": {
                    "Rsc": ["1"],
                    "Next-Url": ["/travel/weekend/2026-11-21"],
                    "Sec-Fetch-Mode": ["cors"]
                }
            }
        }
        rec = parse_log_line(entry)
        self.assertIsNotNone(rec)
        self.assertEqual(rec['is_page_view'], 1)
        self.assertEqual(rec['page_view_type'], 'client_nav')
        self.assertEqual(rec['path'], '/travel/weekend/2026-11-21')

    def test_direct_document_load(self):
        entry = {
            "ts": 1794927277.0,
            "status": 200,
            "request": {
                "remote_ip": "125.119.85.238",
                "method": "GET",
                "uri": "/films/xueyi",
                "headers": {
                    "Sec-Fetch-Dest": ["document"],
                    "Accept": ["text/html,application/xhtml+xml"]
                }
            }
        }
        rec = parse_log_line(entry)
        self.assertIsNotNone(rec)
        self.assertEqual(rec['is_page_view'], 1)
        self.assertEqual(rec['page_view_type'], 'document')
        self.assertEqual(rec['path'], '/films/xueyi')

    def test_geo_label_formatting(self):
        label_cn = build_location_label("中国", "浙江", "杭州", "Chinanet")
        self.assertEqual(label_cn, "浙江 杭州 (Chinanet)")
        label_us = build_location_label("美国", "弗吉尼亚", "阿什本", "Amazon")
        self.assertEqual(label_us, "美国 弗吉尼亚 阿什本 (Amazon)")
        self.assertTrue(is_private_or_loopback("127.0.0.1"))
        self.assertFalse(is_private_or_loopback("125.119.85.238"))


if __name__ == '__main__':
    unittest.main()
