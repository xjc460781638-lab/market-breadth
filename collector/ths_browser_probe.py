"""Bounded public-page crawler trial. Never fabricates a quote time or minute history.

Stops on access restrictions; no login, cookies, challenge solving, or stealth.
The output is diagnostic only until the source's market timestamp is verified.
"""
import asyncio
import datetime as dt
import json
import re
from pathlib import Path

URLS = {
    'industry': 'https://data.10jqka.com.cn/funds/hyzjl/',
    'concept': 'https://data.10jqka.com.cn/funds/gnzjl/',
}

def parse_row(cells, href):
    if len(cells) != 11:
        raise ValueError('Unexpected table columns')
    code = re.search(r'/detail/code/(\d{6})/', href or '')
    if not code or not cells[1].strip():
        raise ValueError('Missing board identity')
    def number(value):
        value=value.strip().replace(',', '')
        if not re.fullmatch(r'-?\d+(?:\.\d+)?',value):
            raise ValueError('Missing/invalid amount')
        return float(value)
    inflow,outflow,net = [number(cells[i]) for i in (4,5,6)]
    # Display amounts are rounded individually to 0.01 billion yuan.
    if abs(inflow-outflow-net)>0.031:
        raise ValueError('Flow arithmetic mismatch')
    return dict(code='ths:'+code[1],name=cells[1].strip(),inflow=inflow,outflow=outflow,net=net,unit='亿元',companies=int(number(cells[7])))

async def crawl(browser, kind, output):
    page=await browser.new_page(locale='zh-CN', viewport={'width':1440,'height':1000})
    result=dict(kind=kind,source='ths',url=URLS[kind],observedAt=dt.datetime.now(dt.timezone.utc).isoformat(),marketAsOf=None,resolution='snapshot',status='pending',rows=[])
    try:
        response=await page.goto(URLS[kind],wait_until='domcontentloaded',timeout=30000)
        result['httpStatus']=response.status if response else None
        body=await page.locator('body').inner_text(timeout=15000)
        if (response and response.status in (401,403,429)) or re.search(r'验证码|访问过于频繁|访问受限|Nginx forbidden|Access Denied',body,re.I):
            result.update(status='blocked',reason='Public page returned an access restriction; stopped without bypass')
            return result
        await page.get_by_role('columnheader',name='净额(亿)',exact=False).wait_for(timeout=15000) if await page.get_by_role('columnheader',name='净额(亿)',exact=False).count() else await page.locator('table').wait_for(timeout=15000)
        all_rows={}
        for page_number in range(1,21):
            body=await page.locator('body').inner_text()
            if re.search(r'验证码|访问过于频繁|访问受限|Nginx forbidden|Access Denied',body,re.I):
                raise RuntimeError('Access restriction during pagination')
            raw=await page.locator('table tr').evaluate_all("rows => rows.filter(r=>r.querySelectorAll('td').length).map(r=>({cells:Array.from(r.querySelectorAll('td'),x=>x.innerText.trim()),href:r.querySelector('a[href*=\"/detail/code/\"]')?.href??''}))")
            if not raw:raise ValueError('No rendered table rows')
            rows=[parse_row(r['cells'],r['href']) for r in raw]
            if any(r['code'] in all_rows for r in rows):raise ValueError('Pagination repeated a board')
            all_rows.update((r['code'],r) for r in rows)
            pagination=re.search(r'(\d+)\s*/\s*(\d+)\s*$',await page.locator('body').inner_text())
            # The visible footer follows pagination, so inspect the page-info node.
            info=page.locator('.page_info')
            if await info.count():pagination=re.search(r'(\d+)\s*/\s*(\d+)',await info.first.inner_text())
            if not pagination:
                matches=re.findall(r'(?m)^\s*(\d+)\s*/\s*(\d+)\s*$',body)
                if matches:pagination=re.match(r'(\d+)/(\d+)', '/'.join(matches[-1]))
            if not pagination:raise ValueError('Cannot verify pagination completeness')
            current,total=map(int,pagination.groups())
            if current!=page_number or total>20:raise ValueError('Invalid page counter')
            result['pages']=dict(current=current,total=total)
            if current==total:break
            previous=raw[0]['cells'][1]
            await page.get_by_role('link',name='下一页',exact=True).click(timeout=10000)
            await page.wait_for_function("old => document.querySelector('table tbody tr td:nth-child(2)')?.innerText.trim()!==old",arg=previous,timeout=15000)
            await page.wait_for_timeout(750)
        result['rows']=list(all_rows.values())
        # Public ranking has no verified market date: retain null, not the crawl date.
        result.update(status='snapshot_only',reason='Ranking captured; market timestamp and historical minute series not established')
        return result
    except Exception as error:
        result.update(status='failed',reason=type(error).__name__+': '+str(error)[:220])
        return result
    finally:
        try:await page.screenshot(path=str(output/(kind+'.png')),full_page=True,timeout=15000)
        except Exception:pass
        await page.close()

async def main():
    from playwright.async_api import async_playwright
    output=Path('.probe/ths');output.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        results=[]
        for kind in URLS:
            result=await crawl(browser,kind,output);results.append(result)
            print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False),flush=True)
            print(f'{kind}: {len(result["rows"])} validated rows',flush=True)
        await browser.close()
    (output/'result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
    if any(r['status']!='snapshot_only' for r in results):raise SystemExit('Browser trial incomplete; production untouched')

if __name__=='__main__':asyncio.run(main())
