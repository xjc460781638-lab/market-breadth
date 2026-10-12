"""Board flow snapshots. Bootstrap/final fetch genuine minute curves; intraday
adds source-timestamped board ranking observations without inventing points."""
import argparse,concurrent.futures,datetime as dt
from collector.boards import catalog,curve,INDICES,quotes
from collector.run import ROOT,load,calendar,in_session,TZ
from collector.board_store import finish

def previous(group):
    paths=[ROOT/'.cache/boards'/f'flow-{group}.json',ROOT/'data/boards'/f'flow-{group}.json']
    reports=[load(p) for p in paths if p.exists()]
    return max(reports,key=lambda r:r['collectedAt']) if reports else {}

def collect(group,mode,no_publish=False):
    old=previous(group);now=dt.datetime.now(TZ);oldboards={b['code']:b for b in old.get('boards',[])}
    raw=[dict(f12=c,f14=n) for c,n in INDICES] if group=='index' else catalog(group)
    results=[]
    def get(row):
        code=row['f12'] if group=='index' else '90.'+row['f12'];name=row['f14']
        prior=oldboards.get(code,{});points=dict(zip(old.get('times',[]),prior.get('values',[])))
        try:
            # Fetch the complete current-session curve so missed schedules self-heal.
            rows=curve(code);points={r['time']:round(r['main'],4) for r in rows};stamp=rows[-1]['time'];value=rows[-1]['main']
            if mode=='intraday' and stamp[:10]!=str(now.date()):raise ValueError('Stale curve')
            if prior.get('asOf') and stamp<prior['asOf']:raise ValueError('Regressive board data')
            return dict(code=code,name=name,asOf=stamp,net=round(value,4),error=None),points
        except Exception:
            return dict(code=code,name=name,asOf=prior.get('asOf'),net=prior.get('net'),error='源站暂不可用；保留上次有效数据' if points else '源站暂未返回有效资金数据'),points
    with concurrent.futures.ThreadPoolExecutor(5) as pool:
        for i,result in enumerate(pool.map(get,raw),1):
            results.append(result)
            if i%50==0:print(f'{group} curves {i}/{len(raw)}',flush=True)
    stamps=[b['asOf'] for b,_ in results if b['asOf']]
    if not stamps:raise ValueError(f'{group}: no usable board flows')
    asof=max(stamps);day=asof[:10];times=sorted({t for _,points in results for t in points if t[:10]==day})[-300:]
    boards=[]
    for item,points in results:
        item['values']=[points.get(t) for t in times]
        if item['asOf'] and item['asOf'][:10]!=day:item.update(net=None,error='该板块数据日期落后，未混入当前日排名')
        boards.append(item)
    report=dict(kind='flow-'+group,asOf=asof,calendar=calendar(now),times=times,boards=boards)
    finish(report,no_publish)
    failures=sum(b['error'] is not None for b in boards);print(f'{group}: {len(boards)-failures}/{len(boards)} fresh boards',flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['bootstrap','intraday','final'],default='bootstrap');p.add_argument('--no-publish',action='store_true');args=p.parse_args();now=dt.datetime.now(TZ);sessions=calendar(now)
    if args.mode=='intraday' and str(now.date()) in sessions and now.hour>=15:
        args.mode='final'
        print('Delayed intraday task: collecting closing curves',flush=True)
    if args.mode=='intraday' and not in_session(now,sessions):print('Outside session');return
    if args.mode=='final' and str(now.date()) not in sessions:print('Holiday');return
    errors=[]
    for group in ['concept','industry','index']:
        try:collect(group,args.mode,args.no_publish)
        except Exception as e:print(group,type(e).__name__,str(e)[:120],flush=True);errors.append(group)
    if errors:raise SystemExit('Source failures: '+', '.join(errors))
if __name__=='__main__':main()
