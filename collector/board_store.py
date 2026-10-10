"""Shared bounded board report storage and authenticated publication."""
import hashlib,json,os,datetime as dt
import requests
from collector.run import ROOT,save,TZ

def finish(report,no_publish=False):
 report.update(schemaVersion=1,collectedAt=dt.datetime.now(TZ).isoformat())
 report['revision']=hashlib.sha256(json.dumps(report,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:24]
 payload=json.dumps(report,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
 if len(payload)>1800000:raise ValueError('Board document exceeds storage budget')
 path=ROOT/'data/boards'/f"{report['kind']}.json"
 if not path.exists() or {k:v for k,v in json.loads(path.read_text(encoding='utf8')).items() if k not in ['revision','collectedAt']}!={k:v for k,v in report.items() if k not in ['revision','collectedAt']}:save(path,report)
 save(ROOT/'.cache/boards'/f"{report['kind']}.json",report)
 print(json.dumps({'kind':report['kind'],'asOf':report['asOf'],'boards':len(report['boards']),'bytes':len(payload)}),flush=True)
 if no_publish:return report
 url=os.environ.get('SITE_URL','').rstrip('/');token=os.environ.get('SITE_INGEST_TOKEN');service=os.environ.get('SITE_SERVICE_TOKEN')
 if not(url and token and service):print('Board Site sync pending');return report
 if not url.startswith('https://') or not url.endswith('.chatgpt.site'):raise ValueError('Invalid Site origin')
 headers={'Authorization':f'Bearer {token}','OAI-Sites-Authorization':f'Bearer {service}','Content-Type':'application/json'}
 r=requests.post(url+'/api/boards/ingest',data=payload,headers=headers,timeout=45,allow_redirects=False)
 if r.status_code!=200:raise RuntimeError(f"{report['kind']} sync HTTP {r.status_code}")
 check=requests.get(url+'/api/boards/readback',params={'kind':report['kind']},headers=headers,timeout=30,allow_redirects=False)
 if check.status_code!=200 or check.json().get('revision')!=report['revision']:raise RuntimeError('Board readback mismatch')
 print(report['kind']+' private Site readback verified',flush=True)
 return report
