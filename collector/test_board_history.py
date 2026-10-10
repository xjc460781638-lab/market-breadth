import unittest,tempfile,json
from pathlib import Path
from unittest.mock import patch,Mock
import collector.board_history as h
class HistoricalFlowsTests(unittest.TestCase):
 def test_daily_units_and_missing_not_zero(self):
  source=Mock();source.json.return_value={'data':{'klines':['2026-10-08,-6542891776,0','2026-10-09,-558962944,0']}}
  def response(*args,**kwargs):
   if kwargs['params']['secid'].endswith('BK0001'):raise RuntimeError('offline')
   return source
  with tempfile.TemporaryDirectory() as tmp,patch.object(h,'ROOT',Path(tmp)),patch.object(h,'catalog',return_value=[{'f12':'BK0689','f14':'阿里概念'},{'f12':'BK0001','f14':'缺失样本'}]),patch.object(h,'INDICES',[]),patch.object(h,'calendar',return_value=['2026-10-08','2026-10-09']),patch.object(h.requests,'get',side_effect=response):
   h.collect()
   r=json.loads((Path(tmp)/'data/boards/history/concept-2026-10-08.json').read_text(encoding='utf8'))
   self.assertEqual(r['resolution'],'close');self.assertEqual(r['times'],['2026-10-08 15:00'])
   self.assertEqual(r['boards'][0]['net'],-65.4289);self.assertEqual(r['boards'][0]['values'],[-65.4289]);self.assertIsNone(r['boards'][1]['net'])
   self.assertEqual(r['boards'][1]['values'],[None])
if __name__=='__main__':unittest.main()
