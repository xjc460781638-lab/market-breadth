"""Backfill actual daily closing board flows, never synthetic minute curves."""
import concurrent.futures,datetime as dt,json,hashlib,requests,os,time
from collector.boards import catalog,INDICES,FIELDS
from collector.run import ROOT,save,calendar,TZ

def collect(groups=None):
 now=dt.datetime.now(TZ);cal=calendar(now);incomplete=[]
 for group in (groups or ['index','industry','concept']):
  raw=[dict(f12=c,f14=n) for c,n in INDICES] if group=='index' else catalog(group)
  def fetch(row):
   code=row['f12'] if group=='index' else '90.'+row['f12'];path=ROOT/'.cache/board-daily'/str(now.date())/f'{code}.json'
   if path.exists():return row,json.loads(path.read_text(encoding='utf8'))
   try:
    time.sleep(0.5)
    r=requests.get('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',params=dict(lmt=10,klt=101,fields1='f1,f2,f3,f7',fields2=FIELDS,secid=code),timeout=(5,10));r.raise_for_status()
    rows=(r.json().get('data') or {}).get('klines') or [];values={x.split(',')[0]:round(float(x.split(',')[1])/1e8,4) for x in rows}
    if values:save(path,values)
    return row,values
   except Exception:return row,{}
  results=[]
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   for i,result in enumerate(pool.map(fetch,raw),1):
    results.append(result)
    if i%100==0:print(group,i,'valid',sum(bool(v) for _,v in results),flush=True)
  dates=sorted({d for _,v in results for d in v})[-10:]
  for day in dates:
   boards=[]
   for row,values in results:
    v=values.get(day);code=row['f12'] if group=='index' else '90.'+row['f12']
    boards.append(dict(code=code,name=row['f14'],asOf=day+' 15:00' if v is not None else None,net=v,values=[v],error=None if v is not None else '该日数据暂不可用'))
   report=dict(schemaVersion=1,kind='flow-'+group,resolution='close',asOf=day+' 15:00',collectedAt=now.isoformat(),calendar=cal,times=[day+' 15:00'],boards=boards)
   report['revision']=hashlib.sha256(json.dumps(report,sort_keys=True).encode()).hexdigest()[:24]
   save(ROOT/'data/boards/history'/f'{group}-{day}.json',report)
  print(group,'days',len(dates),'valid',sum(bool(v) for _,v in results),'/',len(raw),flush=True)
  if raw and sum(bool(v) for _,v in results)<len(raw)*.98:incomplete.append(group)
 return incomplete
def publish():
 url=os.environ.get('SITE_URL','').rstrip('/');token=os.environ.get('SITE_INGEST_TOKEN');service=os.environ.get('SITE_SERVICE_TOKEN')
 if not (url and token and service):return
 headers={'Authorization':'Bearer '+token,'OAI-Sites-Authorization':'Bearer '+service,'Content-Type':'application/json'}
 for path in sorted((ROOT/'data/boards/history').glob('*.json')):
  report=json.loads(path.read_text(encoding='utf8'))
  r=requests.post(url+'/api/boards/ingest?archive=1',json=report,headers=headers,timeout=40,allow_redirects=False)
  if r.status_code!=200:raise RuntimeError('History write HTTP '+str(r.status_code))
  r=requests.get(url+'/api/boards/readback',params={'kind':report['kind'],'date':report['asOf'][:10]},headers=headers,timeout=30)
  if r.status_code!=200 or r.json().get('revision')!=report['revision']:raise RuntimeError('History readback mismatch')
  print(path.name+' readback verified',flush=True)
if __name__=='__main__':
 import sys
 incomplete=collect(['index','industry'] if '--index-industry' in sys.argv else None) if '--sync' not in sys.argv else []
 publish()
 if incomplete:raise SystemExit('Incomplete source coverage: '+', '.join(incomplete))

