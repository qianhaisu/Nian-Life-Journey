import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('retention', Path(__file__).resolve().parents[1] / 'scripts' / 'ecs-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)
def container(name, image, status='exited'):
    return {'Name': '/' + name, 'Image': image, 'Config': {'Image': 'nianlife-web:' + image}, 'State': {'Status': status, 'Health': {'Status': 'healthy'}}}
class RetentionTests(unittest.TestCase):
    def test_failed_release_is_removed_never_retained(self):
        live = container('nianlife-diag-web', 'eeeeeee', 'running')
        older = container('nianlife-diag-web-pre-aaaaaaa-20260924-100000', 'aaaaaaa')
        newer = container('nianlife-diag-web-pre-bbbbbbb-20260924-110000', 'bbbbbbb')
        failed = container('nianlife-diag-web-failed-20260924-120000', 'ccccccc')
        unrelated = container('another-app', 'ddddddd')
        keep, remove = retention.plan([live, older, failed, newer, unrelated])
        self.assertEqual(keep, [live, newer, older])
        self.assertEqual(remove, [failed])
    def test_running_failed_container_blocks_cleanup(self):
        with self.assertRaises(RuntimeError):
            retention.plan([container('nianlife-diag-web', 'eeeeeee', 'running'), container('nianlife-diag-web-failed-20260924-120000', 'ccccccc', 'running')])
    def test_unhealthy_current_blocks_cleanup(self):
        with self.assertRaises(RuntimeError):
            retention.plan([container('nianlife-diag-web', 'eeeeeee')])
if __name__ == '__main__': unittest.main()
