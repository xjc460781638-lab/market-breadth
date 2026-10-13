"""Local refresh worker: persists iFinD data before publishing to the private site."""
import argparse
import json
import os
import threading
import time
from pathlib import Path
import requests
from collector.ifind_collect import collect, CACHE, read

ROOT=Path(__file__).resolve().parents[1]


def settings():
    result={}
    path=ROOT/'.env.collector.local'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line:
                key,value=line.split('=',1);result[key]=value.strip()
    result.update({k:v for k,v in os.environ.items() if k in ['SITE_URL','SITE_INGEST_TOKEN','SITE_BYPASS_TOKEN']})
    if any(not result.get(k) for k in ['SITE_URL','SITE_INGEST_TOKEN','SITE_BYPASS_TOKEN']):
        raise RuntimeError('Local site connection is not configured')
    if result['SITE_URL']!='https://market-breadth-observatory-261010.xjc460781638.chatgpt.site':
        raise RuntimeError('Unexpected site origin')
    return result


class Site:
    def __init__(self):
        config=settings()
        self.url=config['SITE_URL']
        self.headers={'Authorization':'Bearer '+config['SITE_INGEST_TOKEN'],'OAI-Sites-Authorization':'Bearer '+config['SITE_BYPASS_TOKEN']}

    def request(self,method,path,body=None):
        try:
            response=requests.request(method,self.url+path,headers=self.headers,json=body,timeout=(10,60),allow_redirects=False)
        except requests.RequestException:
            raise RuntimeError('Website connection failed; local cache retained') from None
        if response.status_code==409 and '/ingest' in path:return {'unchanged':True}
        if not response.ok:raise RuntimeError(f'Website {path.split("?")[0]} returned HTTP {response.status_code}')
        return response.json()

    def publish(self,reports):
        for scope,report in reports:
            path={'breadth':'/api/ingest','analytics':'/api/analytics/ingest','boards':'/api/boards/ingest'}[scope]
            self.request('POST',path,report)


def cached_reports():
    result=[]
    for scope in ['breadth','analytics']:
        report=read(CACHE/'reports'/(scope+'.json'))
        if report:result.append((scope,report))
    for path in sorted((CACHE/'reports').glob('flow-*/*.json')):
        result.append(('boards',read(path)))
    return result


def serve(site):
    # OS lock is released on crashes; never run two workers against the same cache.
    import msvcrt
    lock=(CACHE/'worker.lock').open('a+b')
    lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:raise SystemExit('An iFinD worker is already running')
    while True:
        try:
            job=site.request('GET','/api/collector/jobs').get('job')
            if job:
                stop=threading.Event()
                def heartbeat():
                    while not stop.wait(20):
                        try:site.request('POST','/api/collector/jobs',{'id':job['id'],'lease':job['lease'],'status':'running','message':'本机正在增量采集并保存缓存，请稍候…'})
                        except RuntimeError:pass
                thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
                try:
                    request=json.loads(job['request'])
                    reports=collect(job['scope'],selected=request.get('selected'),day=request.get('day'))
                    if not reports:raise RuntimeError('同花顺未提供此次请求的数据，已保留最近有效结果')
                    site.publish(reports)
                    message='刷新完成：已保存本地缓存并同步网站。'
                    if job['scope']=='flow-index':message+='同花顺未提供的指数资金流向仍显示缺失。'
                    site.request('POST','/api/collector/jobs',{'id':job['id'],'lease':job['lease'],'status':'done','message':message})
                except Exception as error:
                    # Only known sanitized transport errors or fixed messages leave the machine.
                    message=str(error) if isinstance(error,(RuntimeError,ValueError)) else '采集未完成，已保留缓存与最近有效结果'
                    site.request('POST','/api/collector/jobs',{'id':job['id'],'lease':job['lease'],'status':'error','message':message[:250]})
                finally:stop.set();thread.join(timeout=2)
        except Exception as error:
            print('Local worker connection unavailable; retrying in 15 seconds',flush=True)
        time.sleep(15)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish-cache',action='store_true')
    parser.add_argument('--once',choices=['all','breadth','analytics','flow-concept','flow-industry','flow-index'])
    args=parser.parse_args();site=Site()
    if args.publish_cache:
        reports=cached_reports();site.publish(reports);print(f'Published {len(reports)} cached reports')
    elif args.once:site.publish(collect(args.once));print('Refresh completed and saved locally')
    else:serve(site)
