import unittest
from collector.ths_browser_probe import parse_row

class TableTests(unittest.TestCase):
    def test_visible_ranking_units_and_independent_rounding(self):
        cells=['1','影视院线','1493.71','3.67%','54.07','45.38','8.70','20','欢瑞世纪','10.10%','5.34']
        row=parse_row(cells,'http://q.10jqka.com.cn/thshy/detail/code/881175/')
        self.assertEqual(row['net'],8.70)
        self.assertEqual(row['companies'],20)
        cells[6]='--'
        with self.assertRaises(ValueError):parse_row(cells,'http://q.10jqka.com.cn/thshy/detail/code/881175/')
    def test_wrong_metric_or_schema_is_rejected(self):
        with self.assertRaises(ValueError):parse_row(['1','银行'],'')
        with self.assertRaises(ValueError):parse_row(['1','银行','1','1','3','2','9','1','a','1','1'],'https://q.10jqka.com.cn/thshy/detail/code/881155/')

if __name__=='__main__':unittest.main()
