"""Free-data collector. Run `python -m collector.run --mode bootstrap` first."""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import time
from zoneinfo import ZoneInfo
import akshare as ak
import pandas as pd
import requests
import exchange_calendars as xcals
from collector.engine import calculate, align_prices

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'breadth'
TZ = ZoneInfo('Asia/Shanghai')
# Bound every provider request, including APIs without a timeout argument.
_request = requests.sessions.Session.request
def _bounded(self, method, url, **kwargs):
    kwargs.setdefault('timeout', (10, 25))
    return _request(self, method, url, **kwargs)
requests.sessions.Session.request = _bounded

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temp.replace(path)

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def calendar(now):
    cal = xcals.get_calendar('XSHG', start=f'{now.year-3}-01-01', end=f'{now.year}-12-31')
    return [str(d.date()) for d in cal.sessions]

def in_session(now, sessions):
    minute = now.hour * 60 + now.minute
    return str(now.date()) in sessions and (570 <= minute <= 690 or 780 <= minute <= 900)

def industry_map(day, refresh=False):
    path = CACHE / 'industries.json'
    if path.exists():
        cached = load(path)
        if cached['date'] == day or not refresh:
            return cached
    directory = ak.sw_index_first_info()
    names = {str(r['行业代码']).split('.')[0]: str(r['行业名称']) for _, r in directory.iterrows()}
    if len(names) < 28:
        raise ValueError('行业目录不完整；保留旧结果')
    mapping = {}
    for code in names:
        frame = ak.index_component_sw(symbol=code)
        if frame.empty:
            raise ValueError('行业成分为空；保留旧结果')
        for stock in frame['证券代码'].astype(str).str.zfill(6):
            if stock.startswith(('00','30','60','68')):
                if stock in mapping and mapping[stock] != code:
                    raise ValueError('行业成分重复归属')
                mapping[stock] = code
        time.sleep(.2)
    result = {'date': day, 'names': names, 'mapping': mapping}
    save(path, result)
    return result

def symbol(code):
    return ('sh' if code.startswith(('60','68')) else 'sz') + code

def history_one(code, start, end, refresh):
    path = CACHE / 'prices' / f'{code}.json'
    if path.exists():
        old = load(path)
        if old.get('basisDate') == end and old.get('start', start) <= start:
            return code, old
        if not refresh:
            return code, None
    if not refresh:
        return code, None
    for attempt in range(3):
        try:
            df = ak.stock_zh_a_hist_tx(symbol=symbol(code), start_date=start.replace('-',''), end_date=end.replace('-',''), adjust='qfq')
            rows = {str(pd.Timestamp(r['date']).date()): float(r['close']) for _,r in df.iterrows() if pd.notna(r['close'])}
            item = {'basisDate':end, 'start':start, 'prices':rows}
            save(path, item)
            time.sleep(.25)
            return code, item
        except Exception:
            time.sleep(1 + 2*attempt)
    return code, None

def publish(payload):
    url = os.environ.get('SITE_URL', '').rstrip('/')
    token = os.environ.get('SITE_INGEST_TOKEN')
    bypass = os.environ.get('SITE_SERVICE_TOKEN')
    if not (url and token and bypass):
        print('Site sync pending: configure SITE_URL, SITE_INGEST_TOKEN, SITE_SERVICE_TOKEN.', flush=True)
        return False
    if not url.startswith('https://') or not url.endswith('.chatgpt.site'):
        raise ValueError('SITE_URL must be the HTTPS Sites origin')
    headers = {'Authorization': f'Bearer {token}', 'OAI-Sites-Authorization': f'Bearer {bypass}'}
    r = requests.post(url+'/api/ingest', json=payload, headers=headers, timeout=45, allow_redirects=False)
    if r.status_code not in (200,201):
        raise RuntimeError(f'Site sync failed: HTTP {r.status_code}')
    readback = requests.get(url+'/api/collector/readback', headers=headers, timeout=30, allow_redirects=False)
    if readback.status_code != 200 or readback.json().get('revision') != payload['revision']:
        raise RuntimeError('Site readback revision mismatch')
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['bootstrap','intraday','final','sync'], default='intraday')
    parser.add_argument('--asof', help='Historical end date; output remains honestly dated')
    parser.add_argument('--limit', type=int, default=0, help='Diagnostic only; does NOT publish a market report')
    args = parser.parse_args()
    if args.mode == 'sync':
        if not publish(load(ROOT/'data/latest.json')):
            raise SystemExit(2)
        return
    now = dt.datetime.now(TZ)
    sessions = calendar(now)
    if args.mode == 'intraday' and not in_session(now, sessions):
        print('Market closed; no intraday request.')
        return
    day = args.asof or str(now.date())
    dates = [d for d in sessions if d <= day][-270:]
    day = dates[-1]
    live = args.mode == 'intraday'
    historical_end = dates[-2] if live else day
    info = industry_map(day, refresh=not live)
    mapping, names = info['mapping'], info['names']
    # Include unmapped A shares in whole-market denominator, as the original does.
    universe_path = CACHE/'universe.json'
    if live and universe_path.exists():
        universe = load(universe_path)['codes']
    else:
        listings = ak.stock_info_a_code_name()
        universe = sorted({str(x).zfill(6) for x in listings['code'] if str(x).zfill(6).startswith(('00','30','60','68'))})
        if len(universe) < 3000:
            raise ValueError('股票目录不完整')
        save(universe_path, {'date':day,'codes':universe})
    selected = universe[:args.limit] if args.limit else universe
    prices, failures = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(history_one,c,dates[0],historical_end,not live) for c in selected]
        for n, future in enumerate(concurrent.futures.as_completed(futures), 1):
            code, item = future.result()
            if item and item.get('prices'):
                prices[code] = pd.Series(item['prices'], dtype=float)
            else:
                failures.append(code)
            if n % 100 == 0:
                print(f'history {n}/{len(selected)}; successful {len(prices)}', flush=True)
    if args.limit:
        print(json.dumps({'diagnostic':True,'requested':len(selected),'successful':len(prices)}))
        return
    failed_fraction = len(failures)/len(universe)
    if failed_fraction > .02:
        raise ValueError(f'行情读取失败比例 {failed_fraction:.1%}，保留旧结果')
    quote_times = []
    if live:
        quote = ak.stock_zh_a_spot()
        quote['code6'] = quote['代码'].astype(str).str[-6:]
        quote = quote.set_index('code6')
        for code, series in prices.items():
            if code in quote.index:
                row = quote.loc[code]
                p = row['最新价']
                # Never compare an ex-rights quote against yesterday's unrebased MA.
                previous = series.get(historical_end)
                if pd.notna(p) and p > 0 and previous is not None and abs(float(row['昨收'])-previous) <= .011:
                    prices[code].loc[day] = float(p)
                    if '时间戳' in row and pd.notna(row['时间戳']):
                        quote_times.append(str(row['时间戳']))
    matrix = align_prices(prices, dates)
    result = calculate(matrix, mapping, names)
    eligible = result['eligibleStocks']
    # Report incompleteness explicitly; no fabricated market values during bootstrap.
    if eligible < 1000:
        raise ValueError('有效样本不足1000只，保留旧结果')
    result.update({
        'schemaVersion':1, 'asOf':day, 'collectedAt':now.isoformat(),
        'sourceAsOf':None if live else day,
        'quoteTimeRange':[min(quote_times),max(quote_times)] if quote_times else None,
        'kind':'intraday' if live else 'final', 'window':20, 'historyDays':250,
        'universeStocks':len(universe), 'coverage':round(eligible/len(universe)*100,2),
        'failedStocks':len(failures), 'excludedStocks':len(universe)-eligible,
        'industryAsOf':info['date'], 'calendar':[d for d in sessions if d >= dates[0]][:550],
        'source':'新浪行情 / 腾讯前复权日线 / 申万行业成分（AKShare）',
        'notes':['当前在市沪深A股；含ST，不含北交所、B股和基金。', '缺失日线不推测为停牌，不填零；缺失窗口的股票剔除。', '使用报告日期的行业成分回看历史，并非逐日历史成分。', '免费源与聚宽复权、退市样本及分类可能不同。', '盘中除权基准不一致或无有效报价的股票暂时剔除，并反映在覆盖率中。']
    })
    result['revision'] = hashlib.sha256(json.dumps(result,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:24]
    save(ROOT/'data/latest.json', result)
    print(json.dumps({'asOf':day,'eligible':eligible,'coverage':result['coverage'],'revision':result['revision']}), flush=True)
    publish(result)

if __name__ == '__main__':
    main()
