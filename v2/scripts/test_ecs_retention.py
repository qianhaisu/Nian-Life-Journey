"""Offline safety tests: no Docker/production access."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("retention", pathlib.Path(__file__).with_name("ecs-retention.py"))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


def container(name, image="nianlife-web:1234567", state="exited", healthy=True):
    return {"Name": "/"+name, "Image": image, "Config": {"Image": image},
            "State": {"Status": state, "Health": {"Status": "healthy" if healthy else "unhealthy"}}}


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.live = container("nianlife-diag-web", state="running")

    def test_keeps_two_by_swap_time_not_input_order(self):
        old = container("nianlife-diag-web-pre-aaaaaaa-20260917-120000", "nianlife-web:aaaaaaa")
        newest = container("nianlife-diag-web-pre-bbbbbbb-20260919-120000", "nianlife-web:bbbbbbb")
        middle = container("nianlife-diag-web-pre-ccccccc-20260918-120000", "nianlife-web:ccccccc")
        keep, remove = retention.plan([old, newest, self.live, middle])
        self.assertEqual(keep, [self.live, newest, middle])
        self.assertEqual(remove, [old])

    def test_duplicate_versions_do_not_consume_rollback_slots(self):
        a = container("nianlife-diag-web-pre-aaaaaaa-20260919-120000", "nianlife-web:aaaaaaa")
        duplicate = container("nianlife-diag-web-pre-aaaaaaa-20260918-120000", "nianlife-web:aaaaaaa")
        b = container("nianlife-diag-web-pre-bbbbbbb-20260917-120000", "nianlife-web:bbbbbbb")
        keep, remove = retention.plan([self.live, duplicate, b, a])
        self.assertEqual(keep, [self.live, a, b])
        self.assertEqual(remove, [duplicate])

    def test_does_not_delete_unrelated_or_failed_containers(self):
        keep, remove = retention.plan([self.live, container("nianlife-caddy", "caddy:2"),
                                       container("nianlife-diag-web-failed-20260919-120000")])
        self.assertEqual(keep, [self.live])
        self.assertEqual(remove, [])

    def test_unhealthy_current_blocks_cleanup(self):
        self.live["State"]["Health"]["Status"] = "unhealthy"
        with self.assertRaises(RuntimeError):
            retention.plan([self.live])

    def test_running_rollback_blocks_cleanup(self):
        with self.assertRaises(RuntimeError):
            retention.plan([self.live, container("nianlife-diag-web-pre-aaaaaaa-20260917-120000", state="running")])

    def test_unexpected_image_blocks_cleanup(self):
        with self.assertRaises(RuntimeError):
            retention.plan([self.live, container("nianlife-diag-web-pre-aaaaaaa-20260917-120000", "other:latest")])


if __name__ == "__main__":
    unittest.main()
