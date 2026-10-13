import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from collector.ifind_cache import HistoryCache


def response(day, price=10):
    return {'tables': [{'thscode': '000001.SZ', 'time': [day], 'table': {'close': [price]}}]}


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'cache.sqlite3'
        self.cache = HistoryCache(self.path)
        self.client = Mock()

    def tearDown(self):
        self.cache.close()
        self.tmp.cleanup()

    def test_restart_reuses_persisted_history_without_network(self):
        self.client.history.return_value = response('2026-10-12')
        expected = self.cache.history(self.client, '000001.SZ', 'close', '2026-10-10', '2026-10-12')
        self.cache.close()
        self.cache = HistoryCache(self.path)
        actual = self.cache.history(self.client, '000001.SZ', 'close', '2026-10-10', '2026-10-12')
        self.assertEqual(expected, actual)
        self.assertEqual(self.client.history.call_count, 1)

    def test_only_new_dates_are_requested(self):
        self.client.history.side_effect = [response('2026-10-12'), response('2026-10-13', 11)]
        self.cache.history(self.client, '000001.SZ', 'close', '2026-10-10', '2026-10-12')
        rows = self.cache.history(self.client, '000001.SZ', 'close', '2026-10-10', '2026-10-13')
        self.assertEqual(self.client.history.call_args.args[-2:], ('2026-10-13', '2026-10-13'))
        self.assertEqual([r['close'] for r in rows], [10, 11])

    def test_empty_response_does_not_mark_interval_complete(self):
        self.client.history.return_value = {'tables': [{'thscode': '000001.SZ'}]}
        with self.assertRaises(ValueError):
            self.cache.history(self.client, '000001.SZ', 'close', '2026-10-12', '2026-10-12')
        self.assertEqual(self.cache.missing(self.cache.key('000001.SZ', 'close', {}), '2026-10-12', '2026-10-12'), [('2026-10-12', '2026-10-12')])

    def test_adjustment_parameters_are_isolated(self):
        self.assertNotEqual(self.cache.key('000001.SZ', 'close', {'CPS':'1'}), self.cache.key('000001.SZ', 'close', {'CPS':'2'}))

    def test_moving_adjustment_basis_cannot_silently_reuse_prices(self):
        with self.assertRaisesRegex(ValueError, 'explicit baseDate'):
            self.cache.history(self.client, '000001.SZ', 'close', '2026-10-10', '2026-10-12', CPS='2')
        self.client.history.assert_not_called()

    def test_invalidate_is_scoped_to_one_series(self):
        self.cache.store('a', '2026-10-12', '2026-10-12', response('2026-10-12')['tables'][0], 'close')
        self.cache.store('b', '2026-10-12', '2026-10-12', response('2026-10-12')['tables'][0], 'close')
        self.cache.invalidate('a')
        self.assertEqual(self.cache.read('a', '2026-10-12', '2026-10-12'), [])
        self.assertEqual(len(self.cache.read('b', '2026-10-12', '2026-10-12')), 1)
