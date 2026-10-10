"""Eastmoney board catalog/flows, separate from SW industry breadth."""
import datetime as dt, json, math, concurrent.futures
from collector.analytics import get_json, number, flow_rows, TZ, FIELDS

def listing(fs,fields):
    rows=[];total=None
    host='29' if fs.startswith('b:') else ('79' if 't:3' in fs else '17')
    for page in range(1,51):
        j=get_json(f'https://{host}.push2.eastmoney.com/api/qt/clist/get',dict(pn=page,pz=100,po=1,np=1,ut='b2884a393a59ad64002292a3e90d46a5',fltt=2,invt=2,fid='f12',fs=fs,fields=fields))
        data=j.get('data') or {};part=data.get('diff') or []
        if isinstance(part,dict):part=list(part.values())
        total=int(data.get('total',0))
        rows.extend(part)
        if len(rows)>=total:break
        if not part:raise ValueError('Incomplete board listing')
    if not rows or len(rows)<total:raise ValueError('Missing board listing')
    return rows

def catalog(group):
    kind={'concept':3,'industry':2}[group]
    return listing(f'm:90 t:{kind} f:!50','f12,f14,f62,f124')

def members(code):
    raw=listing(f'b:{code} f:!50','f12,f13')
    return sorted({str(r['f12']) for r in raw if str(r['f12']).startswith(('00','30','60','68')) and r.get('f13') in (0,1)})

def curve(secid):
    j=get_json('https://push2.eastmoney.com/api/qt/stock/fflow/kline/get',dict(lmt=0,klt=1,fields1='f1,f2,f3,f7',fields2=FIELDS,ut='b2884a393a59ad64002292a3e90d46a5',secid=secid))
    return flow_rows(j.get('data') or {})

INDICES=[('0.399300','沪深300'),('1.000905','中证500'),('1.000852','中证1000'),('2.932000','中证2000'),('0.399006','创业板指'),('1.000016','上证50'),('1.000688','科创50')]
if __name__=='__main__':
    for group in ['concept','industry']:
        try:
            rows=catalog(group);r=rows[0];print(group,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
            c=curve('90.'+r['f12']);print('curve',group,len(c),c[-1]['time'],flush=True)
            if group=='concept':print('members',len(members(r['f12'])),flush=True)
        except Exception as e:print(group,'ERROR',type(e).__name__,str(e)[:160],flush=True)
    def probe(item):
        try:
            c=curve(item[0]);return (item[0],item[1],len(c),c[-1]['main'])
        except Exception as e:return(item[0],item[1],type(e).__name__)
    with concurrent.futures.ThreadPoolExecutor(4) as p:
        for r in p.map(probe,INDICES):print(json.dumps(r,ensure_ascii=False),flush=True)

