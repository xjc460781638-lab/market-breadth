import datetime as dt
import unittest
from collector.run import completed_day

class CollectionDateTests(unittest.TestCase):
    def test_delayed_final_never_uses_unclosed_session(self):
        sessions = ['2026-10-09', '2026-10-12', '2026-10-13']
        for hour in [2, 9, 14, 15]:
            self.assertEqual(completed_day(dt.datetime(2026,10,13,hour), sessions), '2026-10-12')
        self.assertEqual(completed_day(dt.datetime(2026,10,13,16), sessions), '2026-10-13')
        self.assertEqual(completed_day(dt.datetime(2026,10,11,12), sessions), '2026-10-09')
