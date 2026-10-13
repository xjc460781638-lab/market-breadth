import unittest
from collector.ifind_datasets import cumulative_flow, FLOW_FIELDS


class FlowTests(unittest.TestCase):
    def test_active_flow_and_running_total(self):
        table = {'time': ['2026-10-12 09:30', '2026-10-12 09:31'],
                 'table': dict(zip(FLOW_FIELDS, [[10, 15], [5, 30], [20, 2], [8, 1]]))}
        table['table']['possitive_buy_large_amt'] = [10000, 10000]
        self.assertEqual([v['net'] for v in cumulative_flow(table)], [17, 3])

    def test_unknown_increment_never_becomes_zero(self):
        table = {'time': ['2026-10-12 09:30', '2026-10-12 09:31'],
                 'table': dict(zip(FLOW_FIELDS, [[None, 15], [5, 30], [20, 2], [8, 1]]))}
        self.assertEqual([v['net'] for v in cumulative_flow(table)], [None, None])

    def test_missing_minute_invalidates_subsequent_cumulative_totals(self):
        table = {'time': ['2026-10-12 09:30', '2026-10-12 09:32'],
                 'table': dict(zip(FLOW_FIELDS, [[10, 15], [5, 30], [20, 2], [8, 1]]))}
        self.assertEqual([v['net'] for v in cumulative_flow(table)], [17, None])
