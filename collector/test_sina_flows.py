import json
import unittest
from unittest.mock import patch
from collector.sina_flows import parse_curve,tencent_curve

class SinaFlowTests(unittest.TestCase):
    def test_tencent_current_day_main_flow_and_empty_are_not_zero(self):
        rows=[dict(time='202610121500',MainNetInflow='-10285859721'),dict(time='202610091500',MainNetInflow='9'),dict(time='202610121200',MainNetInflow='9'),dict(time='202610121400',MainNetInflow='')]
        with patch('collector.sina_flows.read',return_value=json.dumps(dict(data=dict(todayFundTrend=dict(minList=rows))))):
            self.assertEqual(tencent_curve('sina:sh000300','2026-10-12'),{'2026-10-12 15:00':-102.85859721})
        with patch('collector.sina_flows.read',return_value='{"data":{"todayFundTrend":{"minList":[]}}}'):
            with self.assertRaises(ValueError):tencent_curve('sina:sh932000','2026-10-12')
    def test_board_units_session_and_date(self):
        rows=[dict(opendate=d,ticktime=t,netamount=v) for d,t,v in [
            ('2026-10-12','09:30:00','100000000'),('2026-10-12','13:00:00','-200000000'),
            ('2026-10-12','15:00:00','300000000'),('2026-10-12','12:00:00','900000000'),
            ('2026-10-09','15:00:00','900000000'),('2026-10-12','14:00:00','')]]
        actual=parse_curve('sina:new_jrhy','2026-10-12',json.dumps(['6',rows]))
        self.assertEqual(actual,{'2026-10-12 09:30':1,'2026-10-12 13:00':-2,'2026-10-12 15:00':3})
    def test_index_main_flow_is_large_plus_extra_large(self):
        raw='cb("2026-10-12|09:30,100000000,200000000,-300000000,400000000|15:00,-200000000,100000000,0,0");'
        self.assertEqual(parse_curve('sina:sh000905','2026-10-12',raw),{'2026-10-12 09:30':3,'2026-10-12 15:00':-1})
        with self.assertRaises(ValueError):parse_curve('sina:sh000905','2026-10-13',raw)
        with self.assertRaises(ValueError):parse_curve('sina:sh000905','2026-10-12','cb("2026-10-12|");')

if __name__=='__main__':unittest.main()
