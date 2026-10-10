"""Windowed adapter for the same Tencent qfq endpoint used by AKShare.

Avoids AKShare 1.17's listing-date request and overlapping annual requests.
Responses are compared against AKShare in integration verification, not inferred.
"""
import pandas as pd
import requests

def history_window(symbol, start, end):
    response=requests.get('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get',
        params={'param':f'{symbol},day,{start},{end},640,qfq'},timeout=(10,25))
    response.raise_for_status()
    payload=response.json()
    if payload.get('code',0)!=0 or symbol not in payload.get('data',{}):
        raise ValueError('Tencent returned an invalid history response')
    data=payload['data'][symbol]
    # Tencent uses day for securities with no adjustment events.
    rows=data.get('qfqday',data.get('day'))
    if rows is None:
        raise ValueError('Tencent response is missing daily bars')
    frame=pd.DataFrame([{'date':r[0],'close':float(r[2])} for r in rows if start<=r[0]<=end])
    if frame.empty:
        return pd.DataFrame(columns=['date','close'])
    if frame['date'].duplicated().any():
        raise ValueError('Duplicate daily bars')
    return frame
