"""Eastmoney board catalog/flows, separate from SW industry breadth."""
import datetime as dt, json, math, concurrent.futures, requests, re
from functools import lru_cache
from bs4 import BeautifulSoup
from collector.analytics import get_json, number, flow_rows, TZ, FIELDS

def listing(fs,fields):
    rows=[];total=None
    host='29' if fs.startswith('b:') else ('79' if 't:3' in fs else '17')
    for page in range(1,51):
        j=get_json('https://push2.eastmoney.com/api/qt/clist/get',dict(np=1,fltt=2,invt=2,ut='8dec03ba335b81bf4ebdf7b29ec27d15',fs=fs,pn=page,pz=100,fid='f62',po=1,fields=fields))
        data=j.get('data') or {};part=data.get('diff') or []
        if isinstance(part,dict):part=list(part.values())
        total=int(data.get('total',0))
        rows.extend(part)
        if len(rows)>=total:break
        if not part:raise ValueError('Incomplete board listing')
    if not rows or len(rows)<total:raise ValueError('Missing board listing')
    return rows

@lru_cache(maxsize=1)
def page_catalog():
    r=requests.get('https://data.eastmoney.com/bkzj/gn.html',timeout=(10,25));r.raise_for_status()
    soup=BeautifulSoup(r.text,'html.parser');pop=soup.select_one('.bkselectorpop')
    if not pop:raise ValueError('Missing board selector')
    labels=[x.get_text(strip=True) for x in pop.select('.pop_slider li')]
    boxes=pop.select('.pop-cont')
    if len(labels)!=len(boxes):raise ValueError('Board category mismatch')
    result={}
    for label,box in zip(labels,boxes):
        result[label]=[dict(f12=re.search(r'BK\d+',a['href'])[0],f14=a.get_text(strip=True)) for a in box.select('a[href*="BK"]')]
    return result

def catalog(group):
    rows=page_catalog()[{'concept':'概念','industry':'行业'}[group]]
    if len(rows)<50:raise ValueError('Incomplete official board directory')
    return rows

def quotes(rows):
    result=[]
    for i in range(0,len(rows),50):
        chunk=rows[i:i+50]
        j=get_json('https://push2.eastmoney.com/api/qt/ulist.np/get',dict(secids=','.join('90.'+r['f12'] for r in chunk),fields='f12,f14,f62,f124',fltt=2,invt=2))
        data=(j.get('data') or {}).get('diff') or []
        if len(data)!=len(chunk):raise ValueError('Incomplete board quotes')
        result.extend(data)
    return result

def members(code):
    raw=listing(f'b:{code}','f12,f13,f14,f62')
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

