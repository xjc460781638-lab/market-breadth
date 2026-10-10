import unittest
import pandas as pd
from collector.analytics import ratio_rows, flow_rows, update
class AnalyticsTests(unittest.TestCase):
 def test_reference_ratio_and_strict_threshold(self):
  d=pd.date_range('2026-01-01',periods=12).strftime('%Y-%m-%d')
  c=pd.Series([2.]*10+[3.,4.],index=d);h=pd.Series([1.]*12,index=d)
  rows=ratio_rows(c,h)
  self.assertIsNone(rows[8]['ma10']);self.assertEqual(rows[9]['ma10'],2);self.assertFalse(rows[9]['alert']);self.assertAlmostEqual(rows[10]['ma10'],2.1);self.assertTrue(rows[10]['alert'])
  expected=(c/h).rolling(10).mean()
  for row,value in zip(rows,expected):
   if pd.notna(value):self.assertAlmostEqual(row['ma10'],value)
 def test_missing_and_zero_denominator(self):
  d=pd.date_range('2026-01-01',periods=12).strftime('%Y-%m-%d');h=pd.Series(1.,index=d);c=h*2;c.iloc[5]=float('nan');h.iloc[8]=0
  r=ratio_rows(c,h);self.assertIsNone(r[-1]['ma10']);self.assertIsNone(next(x for x in r if x['date']==d[8])['ratio'])
 def test_flow_units_date_and_deduplication(self):
  row='2026-10-09 09:31,300000000,-200000000,-100000000,100000000,200000000'
  rows=flow_rows({'klines':[row,row]});self.assertEqual(len(rows),1);self.assertEqual(rows[0]['main'],3);self.assertEqual(rows[0]['large']+rows[0]['super'],3)
  with self.assertRaises(ValueError):flow_rows({'klines':['09:31,1,2,3,4,5']})
 def test_failure_keeps_last_success(self):
  old={'flow':{'asOf':'2026-10-09 15:00','collectedAt':'2026-10-09T15:01:00+08:00','rows':[{'main':3}]}}
  def failure():raise ConnectionError()
  r=update(old,'flow',failure,'2026-10-10T15:01:00+08:00');self.assertEqual(r['rows'],old['flow']['rows']);self.assertEqual(r['collectedAt'],old['flow']['collectedAt']);self.assertEqual(r['status'],'error')
if __name__=='__main__':unittest.main()
