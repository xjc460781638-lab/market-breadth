"""Overlapping concept breadth using the same eligible price matrix as industries."""
import concurrent.futures,datetime as dt
import numpy as np
from collector.boards import catalog,members
from collector.run import ROOT,CACHE,load,save
from collector.board_store import finish

def calculate_concepts(matrix,directory):
    closes=matrix.sort_index().tail(270).dropna(axis=1,how='any')
    if len(closes)!=270 or len(closes.columns)<1000:raise ValueError('Incomplete concept price window')
    above=closes.tail(250).gt(closes.rolling(20,min_periods=20).mean().tail(250))
    boards=[]
    for code,item in sorted(directory.items()):
        eligible=sorted(set(item['stocks'])&set(above.columns));n=len(eligible)
        values=[int(x) for x in np.rint(above[eligible].sum(axis=1)*100/n)][::-1] if n else [None]*250
        boards.append(dict(code=code,name=item['name'],membershipDate=item['date'],eligible=n,total=len(item['stocks']),values=values))
    return dict(dates=[str(d.date()) for d in above.index][::-1],market=[int(x) for x in np.rint(above.sum(axis=1)*100/len(above.columns))][::-1],boards=boards)

def directory_for(day,refresh):
    path=CACHE/'concept-members.json';old=load(path) if path.exists() else {}
    expected=load(CACHE/'concept-coverage.json')['expected'] if (CACHE/'concept-coverage.json').exists() else 99999
    if old and not refresh:
        if len(old)<expected*.98:raise ValueError('Concept initialization incomplete')
        return old
    raw=catalog('concept');latest={};failures=[]
    save(CACHE/'concept-coverage.json',{'expected':len(raw)})
    def get(row):
        code=row['f12']
        if code in old and old[code]['date']==day:return code,old[code]
        try:
            stocks=members(code)
            if not stocks:raise ValueError('Empty concept')
            return code,dict(name=row['f14'],date=day,stocks=stocks)
        except Exception:return code,None
    with concurrent.futures.ThreadPoolExecutor(5) as pool:
        for i,(code,item) in enumerate(pool.map(get,raw),1):
            if item:latest[code]=item
            elif code in old:latest[code]=old[code];failures.append(code)
            else:failures.append(code)
            if i%50==0:save(path,{**old,**latest})
            if i%50==0:print(f'Concept members {i}/{len(raw)}, unavailable {len(failures)}',flush=True)
    save(path,latest)
    if len(latest)<len(raw)*.98:raise ValueError('Concept member coverage below 98%; preserve previous report')
    save(path,latest)
    return latest

def collect(matrix,report,refresh=True,no_publish=False):
    directory=directory_for(report['asOf'],refresh)
    result=calculate_concepts(matrix,directory)
    result.update(kind='concept-breadth',asOf=report['asOf'],calendar=report['calendar'])
    return finish(result,no_publish)

if __name__=='__main__':
    import argparse,pandas as pd
    from collector.engine import align_prices
    from collector.run import calendar,TZ
    p=argparse.ArgumentParser();p.add_argument('--no-publish',action='store_true');args=p.parse_args()
    report=load(ROOT/'data/latest.json');dates=[d for d in calendar(dt.datetime.now(TZ)) if d<=report['asOf']][-270:]
    prices={}
    for path in (CACHE/'prices').glob('*.json'):
        item=load(path);prices[path.stem]=pd.Series(item['prices'],dtype=float)
    collect(align_prices(prices,dates),report,True,args.no_publish)
