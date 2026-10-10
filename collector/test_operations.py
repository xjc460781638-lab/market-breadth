import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import requests
from collector.run import in_session, quote_matches_basis, history_one, save, load, TZ

class OperationalTests(unittest.TestCase):
    def test_holiday_and_lunch(self):
        sessions=['2026-10-09']
        for hour,minute,expected in [(9,35,True),(11,31,False),(12,30,False),(13,5,True),(15,1,False)]:
            self.assertEqual(in_session(dt.datetime(2026,10,9,hour,minute,tzinfo=TZ),sessions),expected)
        self.assertFalse(in_session(dt.datetime(2026,10,10,10,tzinfo=TZ),sessions))

    def test_split_suspension_and_missing_quote(self):
        self.assertTrue(quote_matches_basis(10.5,10,10))
        self.assertFalse(quote_matches_basis(5,5,10))
        self.assertFalse(quote_matches_basis(0,10,10))
        self.assertFalse(quote_matches_basis(float('nan'),10,10))
        self.assertFalse(quote_matches_basis(10,float('nan'),10))

    def test_repeated_execution_reuses_cache(self):
        with tempfile.TemporaryDirectory() as directory, patch('collector.run.CACHE',Path(directory)), patch('collector.run.ak.stock_zh_a_hist_tx') as fetch:
            item={'basisDate':'2026-10-09','start':'2025-01-01','prices':{'2026-10-09':10}}
            save(Path(directory)/'prices/600000.json',item)
            self.assertEqual(history_one('600000','2025-02-01','2026-10-09',True)[1],item)
            fetch.assert_not_called()

    def test_network_failure_preserves_old_cache(self):
        with tempfile.TemporaryDirectory() as directory, patch('collector.run.CACHE',Path(directory)), patch('collector.run.ak.stock_zh_a_hist_tx',side_effect=requests.ConnectionError), patch('collector.run.time.sleep'):
            file=Path(directory)/'prices/600000.json'
            old={'basisDate':'2026-10-08','start':'2025-01-01','prices':{'2026-10-08':10}}
            save(file,old)
            self.assertIsNone(history_one('600000','2025-02-01','2026-10-09',True)[1])
            self.assertEqual(load(file),old)

if __name__=='__main__': unittest.main()
