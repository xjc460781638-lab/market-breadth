import unittest
import numpy as np
import pandas as pd
from collector.concepts import calculate_concepts
class ConceptTests(unittest.TestCase):
 def test_overlapping_membership_and_missing_window(self):
  dates=pd.date_range('2025-01-01',periods=270)
  prices=pd.DataFrame({f'{i:06}':np.arange(270,dtype=float)+i+1 for i in range(1002)},index=dates)
  prices.loc[dates[2],'000001']=np.nan
  groups={'BK1':{'name':'A','date':'2026-10-09','stocks':['000000','000001']},'BK2':{'name':'B','date':'2026-10-09','stocks':['000000']},'BK3':{'name':'missing','date':'2026-10-09','stocks':['999999']}}
  r=calculate_concepts(prices,groups);a,b,c=r['boards'];self.assertEqual(a['eligible'],1);self.assertEqual(a['values'],b['values']);self.assertEqual(a['values'][0],100);self.assertIsNone(c['values'][0]);self.assertEqual(len(r['dates']),250);self.assertNotIn('sum',r)
 def test_strict_greater_and_bankers_rounding(self):
  dates=pd.date_range('2025-01-01',periods=270);prices=pd.DataFrame(1.,index=dates,columns=[f'{i:06}' for i in range(1000)]);prices.iloc[-1,0]=2
  r=calculate_concepts(prices,{'BK1':{'name':'A','date':'2026-10-09','stocks':['000000','000001','000002','000003','000004','000005','000006','000007']}})
  self.assertEqual(r['boards'][0]['values'][0],12);self.assertEqual(r['boards'][0]['values'][1],0)
if __name__=='__main__':unittest.main()
