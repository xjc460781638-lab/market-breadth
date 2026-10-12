"""Independent full-session Sina flow source; never stitches Eastmoney samples."""
import concurrent.futures
import json
import math
import re
import requests

API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/'
INDICES = [('sh000300','沪深300'),('sh000905','中证500'),('sh000852','中证1000'),('sh932000','中证2000'),('sz399006','创业板指'),('sh000016','上证50'),('sh000688','科创50')]

def read(url, params=None):
    response = requests.get(url, params=params, timeout=(5, 12))
    response.raise_for_status()
    # API text escapes Chinese; explicit UTF-8 avoids requests' Latin-1 default.
    response.encoding = 'utf-8'
    return response.text

def catalog(group):
    if group == 'index':
        return [dict(code='sina:'+code, name=name) for code,name in INDICES]
    rows = json.loads(read(API+'MoneyFlow.ssl_bkzj_bk', dict(page=1,num=1000,sort='netamount',asc=0,fenlei=1 if group=='concept' else 0)))
    if not isinstance(rows,list) or len(rows)<20:
        raise ValueError('Incomplete Sina directory')
    return [dict(code='sina:'+r['category'],name=r['name']) for r in rows]

def parse_curve(code, day, raw):
    points = {}
    if re.fullmatch(r'sina:(sh|sz)\d{6}',code):
        match = re.search(r'\bcb\(("[\s\S]*")\);?\s*$',raw)
        if not match:
            raise ValueError('Invalid Sina index JSONP')
        date,*rows = json.loads(match[1]).split('|')
        if date != day:
            raise ValueError('Stale Sina index curve')
        for row in rows:
            values=row.split(',')
            if len(values)!=5 or not re.fullmatch(r'\d{2}:\d{2}',values[0]):
                continue
            if not values[1].strip() or not values[2].strip():continue
            value=float(values[1])+float(values[2])
            if math.isfinite(value):points[day+' '+values[0]]=value/1e8
    else:
        data=json.loads(raw)
        for row in data[1]:
            if row.get('opendate')!=day or not re.fullmatch(r'\d{2}:\d{2}:\d{2}',row.get('ticktime','')):continue
            raw_value=row.get('netamount')
            if raw_value is None or not str(raw_value).strip():continue
            value=float(raw_value)
            if math.isfinite(value):points[day+' '+row['ticktime'][:5]]=value/1e8
    points={t:v for t,v in points.items() if '09:30'<=t[11:]<='11:30' or '13:00'<=t[11:]<='15:00'}
    if not points:raise ValueError('Sina has no current-day curve')
    return points

def curve(code,day):
    symbol=code.removeprefix('sina:')
    if re.fullmatch(r'(sh|sz)\d{6}',symbol):
        raw=read('https://stock.sina.com.cn/stock/api/jsonp.php/cb/TouziService.getStockMinuteFlow',dict(symbol=symbol))
    else:
        raw=read(API+'MoneyFlow.ssx_bkzj_fszs',dict(page=1,num=300,bankuai=symbol,sort='time'))
    return parse_curve(code,day,raw)

def tencent_curve(code,day):
    raw=json.loads(read('https://proxy.finance.qq.com/cgi/cgi-bin/fundflow/hsfundtab',dict(code=code.removeprefix('sina:'),type='todayFundTrend')))
    points={}
    for row in raw.get('data',{}).get('todayFundTrend',{}).get('minList',[]):
        stamp=row.get('time','');value=row.get('MainNetInflow')
        if not re.fullmatch(r'\d{12}',stamp) or stamp[:8]!=day.replace('-','') or value is None or not str(value).strip():continue
        time=stamp[8:10]+':'+stamp[10:12]
        if not ('09:30'<=time<='11:30' or '13:00'<=time<='15:00'):continue
        value=float(value)
        if math.isfinite(value):points[day+' '+time]=value/1e8
    if not points:raise ValueError('Tencent has no current-day curve')
    return points

def collect(group, now, sessions, previous=None):
    day=str(now.date());directory=catalog(group);previous=previous or {}
    keep=previous.get('source')=='sina' and previous.get('asOf','').startswith(day)
    prior={b['code']:b for b in previous.get('boards',[])} if keep else {}
    def fetch(board):
        old=prior.get(board['code'],{})
        points=dict(zip(previous.get('times',[]),old.get('values',[]))) if old else {}
        error=None
        provider=old.get('provider','sina')
        try:
            try:fresh=curve(board['code'],day);next_provider='sina'
            except Exception:
                if group!='index':raise
                fresh=tencent_curve(board['code'],day);next_provider='tencent'
            if provider!=next_provider:points={}
            provider=next_provider;points.update(fresh)
        except Exception:error='备用源暂未返回该板块当日分时'
        points={t:v for t,v in points.items() if v is not None and t<=now.strftime('%Y-%m-%d %H:%M')}
        return dict(**board,provider=provider),points,error
    with concurrent.futures.ThreadPoolExecutor(8) as pool: results=list(pool.map(fetch,directory))
    times=sorted({t for _,p,_ in results for t in p})
    if not times:raise ValueError('Sina source returned no current-day data')
    boards=[]
    for board,points,error in results:
        last=max(points) if points else None
        boards.append(dict(**board,values=[points.get(t) for t in times],net=points.get(last),asOf=last,error=error))
    return dict(kind='flow-'+group,source='sina',resolution='minute',asOf=times[-1],calendar=sessions,times=times,boards=boards)
