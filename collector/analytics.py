"""Index turnover, intraday market flows and daily margin balances.
Provider field mappings follow Eastmoney's public charts and AKShare adapters.
Missing/failed observations never become zeros; each module retains its last success.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, math, os, time
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
import requests
from collector.run import calendar, in_session, load, save, ROOT

TZ = ZoneInfo('Asia/Shanghai')
FIELDS = ','.join(f'f{i}' for i in range(51,66))

def get_json(url, params):
    for attempt in range(3):
        try:
            r=requests.get(url,params=params,headers={'User-Agent':'Mozilla/5.0','Referer':'https://data.eastmoney.com/'},timeout=(10,25))
            r.raise_for_status()
            result=r.json()
            if result.get('rc',0)!=0 or result.get('success') is False: raise ValueError('Provider rejected request')
            return result
        except (requests.RequestException,ValueError):
            if attempt==2: raise
            time.sleep(attempt+1)

def number(v):
    x=float(v)
    if not math.isfinite(x): raise ValueError('Non-finite observation')
    return x

def index_history(secid, expected):
    j=get_json('https://push2his.eastmoney.com/api/qt/stock/kline/get',dict(secid=secid,fields1='f1,f2,f3,f4,f5',fields2='f51,f52,f53,f54,f55,f56,f57,f58',klt='101',fqt='0',beg='19900101',end=dt.datetime.now(TZ).strftime('%Y%m%d')))
    data=j.get('data') or {}
    if data.get('name')!=expected: raise ValueError('Index identity mismatch')
    rows=[line.split(',') for line in data.get('klines',[])]
    if not rows: raise ValueError('No index history')
    now=dt.datetime.now(TZ)
    completed=[r for r in rows if r[0]<str(now.date()) or now.hour>=15]
    return pd.Series({r[0]:number(r[6]) for r in completed},name=expected).sort_index()

def ratio_rows(csi,hs):
    # Outer alignment preserves gaps: a missing day invalidates its 10-day mean.
    frame=pd.concat([csi.rename('csi'),hs.rename('hs')],axis=1).sort_index()
    ratio=(frame.csi/frame.hs).where((frame.hs>0)&(frame.csi>=0))
    mean=ratio.rolling(10,min_periods=10).mean()
    def val(x): return None if pd.isna(x) or not math.isfinite(x) else float(x)
    return [dict(date=str(d),csiAmount=val(frame.loc[d,'csi']),hsAmount=val(frame.loc[d,'hs']),ratio=val(ratio.loc[d]),ma10=val(mean.loc[d]),alert=bool(pd.notna(mean.loc[d]) and mean.loc[d]>2)) for d in frame.index if d>=csi.first_valid_index()][-3000:]

def turnover():
    rows=ratio_rows(index_history('2.932000','中证2000'),index_history('0.399300','沪深300'))
    if len(rows)<10: raise ValueError('Insufficient turnover history')
    return dict(asOf=rows[-1]['date'],rows=rows)

def flow_rows(data):
    rows=[]
    for line in data.get('klines',[]):
        r=line.split(','); timestamp=r[0]
        # Require provider date: do not attach today's date to an undated stale curve.
        dt.datetime.strptime(timestamp,'%Y-%m-%d %H:%M')
        values=[number(x)/1e8 for x in r[1:6]]
        rows.append(dict(time=timestamp,main=values[0],small=values[1],medium=values[2],large=values[3],super=values[4]))
    rows=sorted({r['time']:r for r in rows}.values(),key=lambda r:r['time'])
    if not rows: raise ValueError('分时接口未返回有效序列')
    latest=rows[-1]['time'][:10]
    return [r for r in rows if r['time'].startswith(latest)]

def flow():
    j=get_json('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get',dict(lmt='0',klt='1',fields1='f1,f2,f3,f7',fields2=FIELDS,ut='b2884a393a59ad64002292a3e90d46a5',secid='1.000001',secid2='0.399001'))
    rows=flow_rows(j.get('data') or {})
    return dict(asOf=rows[-1]['time'],rows=rows)

def margin():
    j=get_json('https://datacenter-web.eastmoney.com/api/data/v1/get',dict(reportName='RPTA_WEB_MARGIN_DAILYTRADE',columns='ALL',pageNumber=1,pageSize=500,sortColumns='STATISTICS_DATE',sortTypes=-1))
    records=(j.get('result') or {}).get('data') or []
    rows=[]
    for r in records:
        total,fin,loan=[number(r[k]) for k in ['MARGIN_BALANCE','FIN_BALANCE','LOAN_BALANCE']]
        if min(total,fin,loan)<0 or abs(total-fin-loan)>.01: raise ValueError('Margin totals inconsistent')
        rows.append(dict(date=r['STATISTICS_DATE'][:10],balance=total,financing=fin,securities=loan,index=number(r['SCI_CLOSE_PRICE'])))
    rows=sorted({r['date']:r for r in rows}.values(),key=lambda r:r['date'])
    if not rows: raise ValueError('No margin data')
    return dict(asOf=rows[-1]['date'],rows=rows)

def update(previous,key,fetch,now):
    try:
        result=fetch()
        if previous.get(key,{}).get('asOf') and result['asOf']<previous[key]['asOf']: raise ValueError('Regressive source timestamp')
        result.update(status='ok',collectedAt=now,error=None)
        return result
    except Exception as exc:
        print(f'{key}: source unavailable ({type(exc).__name__})',flush=True)
        old=previous.get(key) or {}
        return dict(asOf=old.get('asOf'),collectedAt=old.get('collectedAt'),rows=old.get('rows',[]),status='error',error='数据源暂不可用，保留上次有效结果' if old.get('rows') else '数据源暂不可用，尚无有效数据')

def publish(report):
    url=os.environ.get('SITE_URL','').rstrip('/')
    token=os.environ.get('SITE_INGEST_TOKEN'); service=os.environ.get('SITE_SERVICE_TOKEN')
    if not(url and token and service): print('Analytics Site sync pending');return
    if not url.startswith('https://') or not url.endswith('.chatgpt.site'): raise ValueError('Invalid Site origin')
    headers={'Authorization':f'Bearer {token}','OAI-Sites-Authorization':f'Bearer {service}'}
    r=requests.post(url+'/api/analytics/ingest',json=report,headers=headers,timeout=45,allow_redirects=False)
    if r.status_code!=200: raise RuntimeError(f'Analytics sync HTTP {r.status_code}')
    check=requests.get(url+'/api/analytics/readback',headers=headers,timeout=30,allow_redirects=False)
    if check.status_code!=200 or check.json().get('revision')!=report['revision']:raise RuntimeError('Analytics readback mismatch')
    print('Analytics private Site readback verified',flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['bootstrap','intraday','final','sync'],default='bootstrap');p.add_argument('--no-publish',action='store_true');args=p.parse_args()
    path=ROOT/'data/analytics.json';cache=ROOT/'.cache/analytics.json'
    previous=load(cache) if cache.exists() else (load(path) if path.exists() else {})
    now=dt.datetime.now(TZ);sessions=calendar(now)
    if args.mode=='sync':
        if not args.no_publish:publish(previous)
        return
    if args.mode=='final' and str(now.date()) not in sessions:print('Analytics: market holiday');return
    if args.mode=='intraday' and not in_session(now,sessions):print('Analytics: outside trading session');return
    report=dict(schemaVersion=1,collectedAt=now.isoformat(),calendar=sessions,turnover=previous.get('turnover'),flow=previous.get('flow'),margin=previous.get('margin'))
    for key,fetch in [('turnover',turnover),('flow',flow),('margin',margin)]:
        if args.mode=='intraday' and key!='flow' and previous.get(key,{}).get('rows'):continue
        report[key]=update(previous,key,fetch,dt.datetime.now(TZ).isoformat())
        print(json.dumps({'module':key,'status':report[key]['status'],'asOf':report[key]['asOf'],'rows':len(report[key]['rows'])},ensure_ascii=False),flush=True)
    report['collectedAt']=dt.datetime.now(TZ).isoformat()
    report['revision']=hashlib.sha256(json.dumps(report,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:24]
    save(path,report)
    save(cache,report)
    if not args.no_publish:publish(report)

if __name__=='__main__':main()



