"""Thirty-session iFinD initialization and incremental, locally cached refresh."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
from collector.engine import calculate, align_prices
from collector.ifind_client import IFinDClient, IFinDError, local_refresh_token
from collector.ifind_cache import HistoryCache
from collector.ifind_datasets import CACHE, save, turnover_history, margin_history, flow_history, FLOW_FIELDS, cumulative_flow


def now():
    return dt.datetime.now(ZoneInfo('Asia/Shanghai'))


def stamp(report):
    report['revision'] = hashlib.sha256(json.dumps(report, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
    return report


def read(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def sessions(client, cache):
    current = now()
    # A closing daily bar is only finalized after the provider's closing update.
    end = (current.date() if current.strftime('%H:%M') >= '16:30' else current.date()-dt.timedelta(days=1)).isoformat()
    start = (current.date()-dt.timedelta(days=160)).isoformat()
    try:
        rows = cache.history(client, '000001.SH', 'close', start, end)
    except (ValueError,IFinDError) as error:
        if str(error) not in ('iFinD history is empty or incomplete; cache coverage not advanced','iFinD history did not return the requested security','iFinD errorcode -4001'):raise
        # Weekends/holidays do not produce new bars. Retain the last real session.
        rows=cache.read(cache.key('000001.SH','close',{}),start,end)
    days = [r['date'] for r in rows if r['close'] is not None]
    if len(days) < 50:
        raise ValueError('iFinD calendar has fewer than 50 valid sessions')
    client.live_day=None
    if current.strftime('%H:%M')<'16:30':
        quotes=client.query('real_time_quotation',{'codes':'000001.SH','indicators':'latest,tradeDate,tradeTime'})
        table=quotes.get('tables',[{}])[0]
        moment=(table.get('time') or [''])[0]
        if moment[:10]==current.date().isoformat() and moment[:10]>days[-1] and moment[11:16]>='09:30':
            client.live_day=moment[:10]
    return days


def breadth(client, cache, calendar):
    dates = calendar[-50:]
    config_path = CACHE / 'breadth-config.json'
    config = read(config_path)
    if not config:
        config = {'basisDate': dates[-1]}
        save(config_path, config)
    parameters = {'CPS': '2', 'baseDate': config['basisDate']}
    universe = read(CACHE / 'universe.json')
    if not universe:
        universe = client.query('smart_stock_picking', {'searchstring':'沪深A股，股票代码，上市日期', 'searchtype':'stock'})
        save(CACHE / 'universe.json', universe)
    raw = universe['tables'][0]['table']
    all_codes = raw['股票代码']
    codes = [c for c, ipo in zip(all_codes, raw['新股上市日期']) if ipo and ipo <= dates[0] and re.fullmatch(r'(00|30|60|68)\d{4}\.(SH|SZ)',c)]
    membership_path = CACHE / 'sw-membership.json'
    membership = read(membership_path) or {'asOf':dates[-1], 'stocks':{}}
    absent = [c for c in codes if c not in membership['stocks']]
    for i in range(0,len(absent),500):
        batch=absent[i:i+500]
        result=client.basic(','.join(batch), [{'indicator':'ths_the_sw_industry_stock','indiparams':['1',membership['asOf']]}])
        for table in result.get('tables',[]):
            values=table.get('table',{}).get('ths_the_sw_industry_stock',[])
            if values and values[0]:membership['stocks'][table['thscode']]=values[0]
        save(membership_path,membership)
    # Group identical missing ranges; <= 25,000 data cells/request, restart-safe.
    pending={}
    for code in codes:
        for a,b in cache.missing(cache.key(code,'close',parameters),dates[0],dates[-1]):
            pending.setdefault((a,b),[]).append(code)
    for (a,b), group in pending.items():
        for i in range(0,len(group),300):
            batch=group[i:i+300]
            response=client.history(','.join(batch),'close',a,b,**parameters)
            for table in response.get('tables',[]):
                code=table.get('thscode')
                if code in batch and table.get('time'):
                    cache.store(cache.key(code,'close',parameters),a,b,table,'close')
            print(f'breadth cached {min(i+300,len(group))}/{len(group)} ({a}..{b})',flush=True)
    prices={c:pd.Series({r['date']:r['close'] for r in cache.read(cache.key(c,'close',parameters),dates[0],dates[-1])},dtype=float) for c in codes}
    names_set=sorted(set(membership['stocks'].values()))
    # Stable internal identifiers, names/classification supplied by iFinD SW level 1.
    ids={name:str(int(hashlib.sha256(name.encode()).hexdigest()[:10],16)%900000+100000) for name in names_set}
    quote_times=[]
    if getattr(client,'live_day',None):
        live=client.live_day
        live_prices={}
        for i in range(0,len(codes),400):
            response=client.query('real_time_quotation',{'codes':','.join(codes[i:i+400]),'indicators':'latest,preClose,tradeDate,tradeTime'})
            for table in response.get('tables',[]):
                code=table.get('thscode');fields=table.get('table',{});moment=(table.get('time') or [''])[0]
                price=(fields.get('latest') or [None])[0];reference=(fields.get('preClose') or [None])[0]
                if code not in prices or moment[:10]!=live or not price or not reference:continue
                elapsed=(now()-dt.datetime.fromisoformat(moment).replace(tzinfo=ZoneInfo('Asia/Shanghai'))).total_seconds()
                if now().strftime('%H:%M')<'15:00' and elapsed>600 or now().strftime('%H:%M')>='15:00' and moment[11:16]<'15:00':continue
                prior=prices[code].get(dates[-1])
                if pd.isna(prior) or prior<=0:continue
                # Scale the quote onto the fixed historical adjustment basis.
                # iFinD preClose is the day's exchange reference (ex-rights included).
                live_prices[code]=prices[code].copy();live_prices[code].loc[live]=price*prior/reference
                quote_times.append(moment)
        if len(live_prices)<1000:raise ValueError('当日有效同花顺行情不足1000只，已保留历史结果')
        prices=live_prices;dates=dates[1:]+[live];calendar=calendar+[live]
    result=calculate(align_prices(prices,dates),{c:ids[n] for c,n in membership['stocks'].items()},{v:k for k,v in ids.items()},count=30)
    eligible=result['eligibleStocks']
    result.update(schemaVersion=1,provider='ifind',asOf=dates[-1],collectedAt=now().isoformat(),sourceAsOf=dates[-1]+' 15:00:00',quoteTimeRange=None,kind='final',window=20,historyDays=30,universeStocks=len(all_codes),coverage=round(eligible/len(all_codes)*100,2),failedStocks=len(codes)-eligible,excludedStocks=len(all_codes)-eligible,industryAsOf=membership['asOf'],calendar=calendar,source='同花顺 iFinD',notes=['最近30个交易日；MA20额外缓存20个前置交易日。','沪深A股含ST；以当前股票清单筛选期初已上市且历史完整的股票，可能不含期间退市股票。','申万一级行业由iFinD提供；行业代码为网站内部标识。','前复权固定基点 '+config['basisDate']+'；历史缓存只补缺失区间。'])
    if quote_times:
        result.update(kind='intraday' if now().strftime('%H:%M')<'15:00' else 'final',quoteTimeRange=[min(quote_times),max(quote_times)],sourceAsOf=max(quote_times))
    save(CACHE/'reports/breadth.json',stamp(result))
    return result


def analytics(client,cache,calendar):
    start,end=calendar[-40],calendar[-1]
    previous=read(CACHE/'reports/analytics.json')
    collected=now().isoformat()
    def module(rows,error=None):
        return {'status':'error' if error else 'ok','asOf':rows[-1]['date'] if rows else None,'collectedAt':collected,'error':error,'rows':rows[-30:]}
    turnover_rows=turnover_history(client,cache,start,end)
    if getattr(client,'live_day',None):
        response=client.query('real_time_quotation',{'codes':'000300.SH,932000.CSI','indicators':'amount,tradeDate,tradeTime'})
        values={t['thscode']:t for t in response.get('tables',[]) if (t.get('time') or [''])[0][:10]==client.live_day}
        if len(values)==2:
            hs=values['000300.SH']['table']['amount'][0];csi=values['932000.CSI']['table']['amount'][0]
            if hs and csi is not None:
                ratio=csi/hs;sample=[r['ratio'] for r in turnover_rows[-9:]]+[ratio]
                average=sum(sample)/10 if len(sample)==10 and all(v is not None for v in sample) else None
                turnover_rows.append({'date':client.live_day,'hsAmount':hs,'csiAmount':csi,'ratio':ratio,'ma10':average,'alert':average is not None and average>2})
    turnover=module(turnover_rows);turnover['kind']='intraday' if getattr(client,'live_day',None) and now().strftime('%H:%M')<'15:00' else 'final'
    try:margin=module(margin_history(client,cache,(dt.date.fromisoformat(start)-dt.timedelta(days=10)).isoformat(),end))
    except (ValueError,RuntimeError) as e:
        margin=previous['margin'] if previous else module([],str(e))
        margin={**margin,'status':'error','error':str(e)}
    result={'schemaVersion':1,'provider':'ifind','collectedAt':collected,'calendar':calendar,'turnover':turnover,'margin':margin,'flow':{'status':'error','asOf':None,'collectedAt':None,'error':'请查看板块资金流向模块','rows':[]}}
    save(CACHE/'reports/analytics.json',stamp(result))
    return result


def rankings(client,kind,days):
    label={'concept':'同花顺概念指数','industry':'同花顺行业指数','index':'沪深300，中证500，中证1000，中证2000，上证指数，深证成指，创业板指'}[kind]
    def needs(day):
        rows=read(CACHE/'rankings'/kind/(day+'.json'))
        return not rows or kind=='concept' and not any(r['code'].startswith('886') for r in rows) or day==now().date().isoformat() and now().strftime('%H:%M')<'15:05'
    missing=[d for d in days if needs(d)]
    if missing:
        question=f'{label}，{missing[0]}至{missing[-1]}每日主力资金流向，指数代码，指数简称'
        response=client.query('smart_stock_picking',{'searchstring':question,'searchtype':'index'})
        table=response.get('tables',[{}])[0].get('table',{})
        codes=table.get('指数代码',[]);names=table.get('指数简称',[])
        for day in missing:
            field=next((k for k in table if '主力资金流向' in k and day.replace('-','') in k),None)
            if not field:continue
            rows=[{'code':code,'name':names[i],'net':table[field][i]} for i,code in enumerate(codes) if (kind=='concept' and code.startswith(('885','886')) or kind=='industry' and code.startswith('881') or kind=='index' and code in {'000300.SH','000905.SH','000852.SH','932000.CSI','000001.SH','399001.SZ','399006.SZ'})]
            if rows:save(CACHE/'rankings'/kind/(day+'.json'),rows)
    return {day:read(CACHE/'rankings'/kind/(day+'.json')) or [] for day in days}


def top_codes(rows):
    positive=sorted((r for r in rows if r['net'] is not None and r['net']>0),key=lambda r:-r['net'])[:5]
    negative=sorted((r for r in rows if r['net'] is not None and r['net']<0),key=lambda r:r['net'])[:5]
    return {r['code'] for r in positive+negative}


def board_report(client,kind,day,calendar,rows,selected=None):
    selected=top_codes(rows) if selected is None else set(selected)
    if kind=='index':
        rows=[dict(r) for r in rows]
        if not any(r['code']=='932000.CSI' for r in rows):rows.append({'code':'932000.CSI','name':'中证2000','net':None})
        selected|={'000001.SH','399001.SZ','399006.SZ'}
    # The free account has 1.5M HF cells/month. Cache only requested curves;
    # rankings cover all boards, other curves can be loaded by manual refresh.
    missing=[r['code'] for r in rows if r['code'] in selected and not (CACHE/'flows'/day/(r['code']+'.json')).exists() and (r['net'] is not None or kind=='index' and r['code'] in {'000001.SH','399001.SZ','399006.SZ'})]
    for i in range(0,len(missing),20):
        batch=missing[i:i+20]
        response=client.high_frequency(','.join(batch),','.join(FLOW_FIELDS),day+' 09:30:00',day+' 15:00:00')
        for table in response.get('tables',[]):
            if table.get('thscode') in batch and table.get('time'):
                cumulative_flow(table)
                save(CACHE/'flows'/day/(table['thscode']+'.json'),table)
    curves={}
    for row in rows:
        path=CACHE/'flows'/day/(row['code']+'.json')
        if path.exists():curves[row['code']]=flow_history(client,row['code'],day)
    # Preserve the actual 13:01 timestamp; the UI maps it to the 13:00 node
    # while retaining sample-time provenance in the hover tooltip.
    times=[f'{day} {m//60:02}:{m%60:02}' for m in sorted(list(range(570,691,5))+[781]+list(range(780,901,5)))]
    boards=[]
    for row in rows:
        points={p['time']:p['net'] for p in curves.get(row['code'],[])}
        values=[points.get(t) for t in times]
        if kind=='index' and curves.get(row['code']):row={**row,'net':curves[row['code']][-1]['net']}
        boards.append({**row,'provider':'ifind','asOf':day+' 15:00' if row['net'] is not None else None,'values':values,'error':None if any(v is not None for v in values) else ('同花顺未提供该指数主力资金数据' if row['net'] is None else '选择此板块后点击刷新加载分时')})
    observed=[p['time'] for curve in curves.values() for p in curve if p['net'] is not None]
    as_of=max(observed) if observed else day+' 15:00'
    for board in boards:
        points=curves.get(board['code'],[])
        board['asOf']=points[-1]['time'] if points else (day+' 15:00' if day<now().date().isoformat() or now().strftime('%H:%M')>='15:05' else None)
    result=stamp({'schemaVersion':1,'source':'ifind','kind':'flow-'+kind,'resolution':'minute','asOf':as_of,'collectedAt':now().isoformat(),'calendar':calendar,'times':times,'boards':boards})
    save(CACHE/'reports'/('flow-'+kind)/(day+'.json'),result)
    return result


def collect(scope='all', history=False, selected=None, day=None):
    client,cache=IFinDClient(local_refresh_token()),HistoryCache()
    reports=[]
    try:
        calendar=sessions(client,cache)
        if scope in ('all','breadth'):reports.append(('breadth',breadth(client,cache,calendar)))
        if scope in ('all','analytics'):reports.append(('analytics',analytics(client,cache,calendar)))
        for kind in ['concept','industry','index']:
            if scope not in ('all','flow-'+kind):continue
            flow_calendar=calendar+([client.live_day] if getattr(client,'live_day',None) else [])
            days=flow_calendar[-30:] if history else [day or flow_calendar[-1]]
            ranks=rankings(client,kind,days)
            for d in days:
                if not ranks[d]:
                    print(f'{kind} {d}: iFinD did not provide a ranking',flush=True);continue
                if d not in flow_calendar:raise ValueError('请选择有效交易日')
                report=board_report(client,kind,d,flow_calendar,ranks[d],selected)
                reports.append(('boards',report))
                print(f'{kind} {d}: {len(report["boards"])} boards, {sum(any(v is not None for v in b["values"]) for b in report["boards"])} cached curves',flush=True)
    finally:cache.close()
    return reports


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope',default='all',choices=['all','breadth','analytics','flow-concept','flow-industry','flow-index'])
    parser.add_argument('--initialize',action='store_true')
    args=parser.parse_args()
    results=collect(args.scope,args.initialize)
    print(json.dumps({'savedReports':len(results),'cache':str(CACHE)},ensure_ascii=False))
