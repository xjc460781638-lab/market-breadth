import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from collector.ifind_cache import HistoryCache
from collector.ifind_client import IFinDError
from collector.ifind_datasets import margin_history
from collector.ifind_collect import top_codes


class InitializationTests(unittest.TestCase):
    def test_unpublished_margin_tail_keeps_cached_history(self):
        with tempfile.TemporaryDirectory() as folder:
            cache=HistoryCache(Path(folder)/'history.db')
            series=cache.key('沪深两市','balance,financing,securities',{'report':'p03438','period':'日'})
            cache.store(series,'2026-10-12','2026-10-12',{'time':['2026-10-12'],'table':{'balance':[100],'financing':[90],'securities':[10]}},'balance,financing,securities')
            index=cache.key('000001.SH','close',{})
            cache.store(index,'2026-10-12','2026-10-13',{'time':['2026-10-12','2026-10-13'],'table':{'close':[3800,3810]}},'close')
            class Client:
                def query(self,*args):raise IFinDError('iFinD errorcode -4001')
                def history(self,*args,**kwargs):raise AssertionError('Cached history must not be downloaded again')
            rows=margin_history(Client(),cache,'2026-10-12','2026-10-13')
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['index'],3800)
            self.assertEqual(cache.missing(series,'2026-10-12','2026-10-13'),[('2026-10-13','2026-10-13')])
            cache.close()

    def test_default_selection_excludes_unknown_and_zero(self):
        rows=[{'code':str(i),'net':i} for i in range(-10,11)]+[{'code':'missing','net':None}]
        self.assertEqual(top_codes(rows),{str(i) for i in list(range(-10,-5))+list(range(6,11))})


if __name__=='__main__':unittest.main()
