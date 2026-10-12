"""Compact per-stock basis for on-demand MA20 recomputation on the private Site."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import pandas as pd
import requests
from collector.engine import align_prices

ROOT = Path(__file__).resolve().parents[1]

def build_basis(prices, dates, mapping, report, day):
    matrix = align_prices(prices, dates).dropna(axis=1, how='any')
    if len(matrix) != 269 or len(matrix.columns) < 1000:
        raise ValueError('Manual refresh basis requires 269 complete historical sessions')
    flags = matrix.tail(249).gt(matrix.rolling(20, min_periods=20).mean().tail(249))
    # Prices tick in cents. Preserve pandas' exact rolling comparison at the
    # only cent-price near the MA boundary, including floating-point ties.
    boundary = (matrix.tail(19).sum()/19).round(2)
    extended = pd.concat([matrix,pd.DataFrame([boundary],index=pd.to_datetime([day]))])
    boundary_above = boundary.gt(extended.rolling(20,min_periods=20).mean().iloc[-1])
    stocks = [{
        'code':str(code), 'industry':mapping.get(code),
        'previousClose':float(matrix[code].iloc[-1]),
        'sum19':float(matrix[code].tail(19).sum()),
        'boundary':float(boundary[code]),'boundaryAbove':bool(boundary_above[code]),
        'history':''.join('1' if v else '0' for v in flags[code]),
    } for code in matrix.columns]
    basis = {'schemaVersion':1,'day':day,'basisDate':dates[-1],
             'dates':dates[-249:],'stocks':stocks,'template':report}
    basis['revision'] = hashlib.sha256(json.dumps(basis,sort_keys=True).encode()).hexdigest()[:24]
    return basis

def publish_basis(basis):
    path = ROOT/'.cache/breadth/manual-basis.json'
    path.write_text(json.dumps(basis,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    url=os.environ.get('SITE_URL','').rstrip('/')
    token=os.environ.get('SITE_INGEST_TOKEN')
    service=os.environ.get('SITE_SERVICE_TOKEN')
    if not(url and token and service):
        print(f'Manual basis saved locally: {basis["day"]}, {len(basis["stocks"])} stocks',flush=True)
        return
    if not url.startswith('https://') or not url.endswith('.chatgpt.site'): raise ValueError('Invalid Site origin')
    r=requests.post(url+'/api/breadth/basis',json=basis,headers={'Authorization':'Bearer '+token,'OAI-Sites-Authorization':'Bearer '+service},timeout=45,allow_redirects=False)
    if r.status_code != 200 or r.json().get('revision') != basis['revision']:
        raise RuntimeError(f'Manual basis sync failed: HTTP {r.status_code}')
    print(f'Manual basis synced: {basis["day"]}, {len(basis["stocks"])} stocks',flush=True)

def cached_basis():
    from collector.run import calendar,TZ
    cache=ROOT/'.cache/breadth'
    report=json.loads((ROOT/'data/latest.json').read_text(encoding='utf-8'))
    info=json.loads((cache/'industries.json').read_text(encoding='utf-8'))
    today=str(dt.datetime.now(TZ).date())
    sessions=calendar(dt.datetime.now(TZ))
    dates=[d for d in sessions if d<today][-269:]
    prices={}
    for path in (cache/'prices').glob('*.json'):
        item=json.loads(path.read_text(encoding='utf-8'))
        if item['basisDate']==dates[-1]: prices[path.stem]=pd.Series(item['prices'],dtype=float)
    publish_basis(build_basis(prices,dates,info['mapping'],report,today))

if __name__=='__main__': cached_basis()
