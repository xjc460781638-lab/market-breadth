"""Run from repository root: python -m scripts.test-breadth-parity (requires cached prices)."""
import json
import subprocess
import pandas as pd
from collector.engine import align_prices, calculate
from collector.refresh_basis import ROOT

basis=json.loads((ROOT/'.cache/breadth/manual-basis.json').read_text(encoding='utf-8'))
info=json.loads((ROOT/'.cache/breadth/industries.json').read_text(encoding='utf-8'))
dates=[d for d in basis['template']['calendar'] if d<=basis['day']][-270:]
prices={};quotes=[]
for i,stock in enumerate(basis['stocks']):
    code=stock['code']
    values=json.loads((ROOT/'.cache/breadth/prices'/f'{code}.json').read_text(encoding='utf-8'))['prices']
    price=round(stock['previousClose']*(1+((i%9)-4)/100),2)
    previous=stock['previousClose']+(1 if i%29==0 else 0)
    # Exercise missing quotes and ex-rights mismatches: neither can enter denominator.
    if i%17!=0:
        quotes.append({'code':code,'price':price,'previous':previous,'time':basis['day']+' 10:00:00'})
        if abs(previous-stock['previousClose'])<=.011: values[basis['day']]=price
    prices[code]=pd.Series(values,dtype=float)
expected=calculate(align_prices(prices,dates),info['mapping'],info['names'])
fixture={'basis':basis,'quotes':quotes,'expected':expected}
subprocess.run(['node','scripts/test-breadth-refresh.mjs'],input=json.dumps(fixture,ensure_ascii=False),text=True,encoding='utf-8',check=True,cwd=ROOT)
