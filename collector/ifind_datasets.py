"""Verified iFinD datasets with persistent local history (no legacy fallback)."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

from collector.ifind_cache import HistoryCache
from collector.ifind_client import IFinDClient, local_refresh_token

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/ifind'
FLOW_FIELDS = ['active_buy_large_amt', 'active_sell_large_amt',
               'active_buy_main_amt', 'active_sell_main_amt']


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix('.tmp')
    pending.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    pending.replace(path)


def cumulative_flow(table):
    """Main flow equals ACTIVE large + extra-large buys minus sells.

    Verified against iFinD's WCQuery main-flow ranking; passive amounts must not
    be included. A missing increment makes subsequent cumulative values unknown.
    """
    fields, times = table.get('table', {}), table.get('time', [])
    if any(len(fields.get(f, [])) != len(times) for f in FLOW_FIELDS):
        raise ValueError('Incomplete iFinD flow columns')
    total, result, previous = 0., [], None
    for i, moment in enumerate(times):
        stamp = dt.datetime.fromisoformat(moment)
        if (previous is None and moment[11:16] != '09:30') or (previous is not None and
            stamp - previous != dt.timedelta(minutes=1) and
            not (previous.strftime('%H:%M') == '11:30' and stamp.strftime('%H:%M') == '13:01' and previous.date() == stamp.date())):
            total = None
        amounts = [fields[f][i] for f in FLOW_FIELDS]
        if total is None or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in amounts):
            total = None
        else:
            total += amounts[0] - amounts[1] + amounts[2] - amounts[3]
        result.append({'time': moment, 'net': total})
        previous = stamp
    return result


def turnover_history(client, cache, start, end):
    # Unadjusted monetary turnover, in yuan. Each completed day fetched once.
    columns = {}
    for code in ['000300.SH', '932000.CSI']:
        columns[code] = {r['date']: r['amount'] for r in cache.history(client, code, 'close,amount', start, end)}
    rows = []
    for day in sorted(set(columns['000300.SH']) | set(columns['932000.CSI'])):
        hs, csi = columns['000300.SH'].get(day), columns['932000.CSI'].get(day)
        ratio = csi / hs if hs is not None and hs > 0 and csi is not None else None
        rows.append({'date': day, 'hsAmount': hs, 'csiAmount': csi,
                     'ratio': ratio, 'ma10': None, 'alert': False})
        sample = [r['ratio'] for r in rows[-10:]]
        if len(sample) == 10 and all(v is not None for v in sample):
            rows[-1]['ma10'] = sum(sample) / 10
            rows[-1]['alert'] = rows[-1]['ma10'] > 2
    return rows


def margin_history(client, cache, start, end):
    series = cache.key('沪深两市', 'balance,financing,securities', {'report': 'p03438', 'period': '日'})
    for a, b in cache.missing(series, start, end):
        response = client.query('data_pool', {
            'reportname': 'p03438',
            'functionpara': {'sdate': a.replace('-', ''), 'edate': b.replace('-', ''), 'sclx': '沪深两市', 'pl': '日'},
            'outputpara': 'p03438_f001,p03438_f002,p03438_f005,p03438_f014'})
        tables = response.get('tables', [])
        raw = tables[0].get('table', {}) if tables else {}
        dates = [d.replace('/', '-') for d in raw.get('p03438_f001', [])]
        if not dates:
            raise ValueError('iFinD margin balances not published yet')
        # Do not claim coverage for an unpublished trailing day (T+1 release).
        last = max(dates)
        values = {name: [None if v in (None, '') else float(v) * 1e8 for v in raw.get(field, [])]
                  for name, field in [('balance', 'p03438_f002'), ('financing', 'p03438_f005'), ('securities', 'p03438_f014')]}
        cache.store(series, a, last, {'time': dates, 'table': values}, 'balance,financing,securities')
    prices = {r['date']: r['close'] for r in cache.history(client, '000001.SH', 'close', start, end)}
    return [{**row, 'index': prices[row['date']]} for row in cache.read(series, start, end)
            if prices.get(row['date']) is not None and all(row[k] is not None for k in ['balance', 'financing', 'securities'])]


def flow_history(client, code, day):
    """Persist raw minute bars; subsequent calls request only the missing tail."""
    if not all(x.isalnum() or x == '.' for x in code):
        raise ValueError('Invalid iFinD security code')
    dt.date.fromisoformat(day)
    path = CACHE / 'flows' / day / (code + '.json')
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    times = old.get('time', []) if old else []
    gaps = []
    if times:
        known = {moment: i for i, moment in enumerate(times)}
        for minute in list(range(570, 691)) + list(range(781, 901)):
            moment = f'{day} {minute // 60:02}:{minute % 60:02}'
            if moment > times[-1]:
                break
            index = known.get(moment)
            if index is None or any(old.get('table', {}).get(f, [])[index] is None for f in FLOW_FIELDS):
                gaps.append(moment)
    now = dt.datetime.now(ZoneInfo('Asia/Shanghai'))
    finalized = day < now.date().isoformat() or (day == now.date().isoformat() and now.strftime('%H:%M') >= '15:05')
    if times and not gaps and times[-1] == day + ' 15:00' and finalized:
        return cumulative_flow(old)
    start = day + ' 09:30:00'
    if times:
        # Recheck the one overlapping bar: the last intraday minute can be partial.
        start = dt.datetime.fromisoformat(gaps[0] if gaps else times[-1]).strftime('%Y-%m-%d %H:%M:%S')
    response = client.high_frequency(code, ','.join(FLOW_FIELDS), start, day + ' 15:00:00')
    table = next((t for t in response.get('tables', []) if t.get('thscode') == code), None)
    if not table or not table.get('time'):
        if old:
            return cumulative_flow(old)
        raise ValueError('iFinD returned no minute flow data')
    cumulative_flow(table)  # Validate all columns before committing anything.
    points = {t: {f: old['table'][f][i] for f in FLOW_FIELDS} for i, t in enumerate(times)} if old else {}
    for i, t in enumerate(table['time']):
        if t[:10] != day:
            raise ValueError('iFinD returned a different trading date')
        points[t] = {f: table['table'][f][i] for f in FLOW_FIELDS}
    ordered = sorted(points)
    result = {'thscode': code, 'time': ordered, 'table': {f: [points[t][f] for t in ordered] for f in FLOW_FIELDS}}
    save(path, result)
    return cumulative_flow(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True, help='Last completed trading day')
    args = parser.parse_args()
    now = dt.datetime.now(ZoneInfo('Asia/Shanghai'))
    if dt.date.fromisoformat(args.end) >= now.date():
        raise SystemExit('Use a completed previous trading day; live bars are not final history')
    client, cache = IFinDClient(local_refresh_token()), HistoryCache()
    try:
        result = {'source': 'ifind', 'turnover': turnover_history(client, cache, args.start, args.end),
                  'margin': margin_history(client, cache, args.start, args.end)}
        result['revision'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()[:24]
        save(CACHE / 'analytics-history.json', result)
        print(json.dumps({'source': 'ifind', 'turnoverDays': len(result['turnover']),
                          'marginDays': len(result['margin']), 'revision': result['revision']}))
    finally:
        cache.close()


if __name__ == '__main__':
    main()
