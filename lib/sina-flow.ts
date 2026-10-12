const API='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/';
export type SinaBoard={code:string;name:string};
export const sinaIndices:SinaBoard[]=[['sh000300','沪深300'],['sh000905','中证500'],['sh000852','中证1000'],['sh932000','中证2000'],['sz399006','创业板指'],['sh000016','上证50'],['sh000688','科创50']].map(([code,name])=>({code:'sina:'+code,name}));
async function read(url:string) {
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('新浪资金源返回 '+response.status);
  return response.text();
}
export async function sinaCatalog(kind:string):Promise<SinaBoard[]> {
  if(kind==='flow-index')return sinaIndices;
  const rows=JSON.parse(await read(API+'MoneyFlow.ssl_bkzj_bk?'+new URLSearchParams({page:'1',num:'1000',sort:'netamount',asc:'0',fenlei:kind==='flow-concept'?'1':'0'})));
  if(!Array.isArray(rows)||rows.length<20)throw Error('新浪板块目录不完整');
  return rows.map(r=>({code:'sina:'+r.category,name:r.name}));
}
export async function sinaCurve(code:string,day:string):Promise<Map<string,number>> {
  const symbol=code.replace(/^sina:/,'');
  const points=new Map<string,number>();
  if(/^(sh|sz)\d{6}$/.test(symbol)) {
    const text=await read('https://stock.sina.com.cn/stock/api/jsonp.php/cb/TouziService.getStockMinuteFlow?symbol='+symbol);
    const match=text.match(/\bcb\(("[\s\S]*")\);?\s*$/);
    if(!match)throw Error('新浪指数分时格式错误');
    const [date,...rows]=(JSON.parse(match[1]) as string).split('|');
    if(date!==day)throw Error('新浪指数数据日期落后');
    for(const line of rows){const [time,large,mediumLarge]=line.split(',');if(/^\d{2}:\d{2}$/.test(time)&&large?.trim()&&mediumLarge?.trim()&&Number.isFinite(Number(large)+Number(mediumLarge)))points.set(date+' '+time,(Number(large)+Number(mediumLarge))/1e8);}
  } else {
    const data=JSON.parse(await read(API+'MoneyFlow.ssx_bkzj_fszs?'+new URLSearchParams({page:'1',num:'300',bankuai:symbol,sort:'time'})));
    for(const row of data?.[1]??[]) {
      if(row.opendate!==day||!/^\d{2}:\d{2}:\d{2}$/.test(row.ticktime??''))continue;
      if(typeof row.netamount==='string'&&row.netamount.trim()&&Number.isFinite(Number(row.netamount)))points.set(day+' '+row.ticktime.slice(0,5),Number(row.netamount)/1e8);
    }
  }
  for(const time of points.keys())if(!((time.slice(11)>='09:30'&&time.slice(11)<='11:30')||(time.slice(11)>='13:00'&&time.slice(11)<='15:00')))points.delete(time);
  if(!points.size)throw Error('新浪未提供该板块当日分时');
  return points;
}

export async function backupCurve(code:string,day:string) {
  try {return {points:await sinaCurve(code,day),provider:'sina' as const};}
  catch(error) {
    const symbol=code.replace(/^sina:/,'');
    if(!/^(sh|sz)\d{6}$/.test(symbol))throw error;
    const data=JSON.parse(await read('https://proxy.finance.qq.com/cgi/cgi-bin/fundflow/hsfundtab?'+new URLSearchParams({code:symbol,type:'todayFundTrend'})));
    const points=new Map<string,number>();
    for(const row of data?.data?.todayFundTrend?.minList??[]) {
      if(!/^\d{12}$/.test(row.time??'')||row.time.slice(0,8)!==day.replaceAll('-',''))continue;
      const time=row.time.slice(8,10)+':'+row.time.slice(10,12);
      if(!((time>='09:30'&&time<='11:30')||(time>='13:00'&&time<='15:00')))continue;
      if(row.MainNetInflow==null||String(row.MainNetInflow).trim()===''||!Number.isFinite(Number(row.MainNetInflow)))continue;
      points.set(day+' '+time,Number(row.MainNetInflow)/1e8);
    }
    if(!points.size)throw Error('新浪和腾讯均未提供该指数当日分时');
    return {points,provider:'tencent' as const};
  }
}
