import type { Analytics } from './analytics';
type History = {code?:string;name?:string;klines?:unknown[]};
export function refreshTurnover(previous:Analytics['turnover'], histories:History[], calendar:string[], now=new Date()):Analytics['turnover'] {
  const today=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  const expected=[['932000','中证2000'],['399300','沪深300']];
  const maps=expected.map(([code,name],i)=>{
    const source=histories[i];
    if(source?.code!==code || source.name!==name || !Array.isArray(source.klines) || source.klines.length>100) throw Error('指数行情身份或格式不正确');
    const map=new Map<string,number>();
    for(const line of source.klines) {
      if(typeof line!=='string') throw Error('日线数据格式不正确');
      const fields=line.split(','),date=fields[0],amount=Number(fields[6]);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today||!fields[6]?.trim()||!Number.isFinite(amount)||amount<0) throw Error('日线成交额无效');
      map.set(date,amount);
    }
    return map;
  });
  const last=maps.map(map=>[...map.keys()].sort().at(-1));
  if(!last[0] || last[0]!==last[1]) throw Error('两个指数的数据日期不一致，已保留原数据');
  const cn=new Date(now.getTime()+8*3600000),minute=cn.getUTCHours()*60+cn.getUTCMinutes();
  if(calendar.includes(today)&&minute>=570&&last[0]!==today) throw Error('行情源尚未返回今日成交额，已保留原数据');
  if(previous.rows.at(-1)?.date && previous.rows.at(-1)!.date>last[0]) throw Error('行情源返回旧数据，已保留原数据');
  const rows=new Map(previous.rows.map(row=>[row.date,{...row}]));
  for(const date of new Set([...maps[0].keys(),...maps[1].keys()])) {
    const csiAmount=maps[0].get(date)??null,hsAmount=maps[1].get(date)??null;
    rows.set(date,{date,csiAmount,hsAmount,ratio:csiAmount!==null&&hsAmount!==null&&hsAmount>0?csiAmount/hsAmount:null,ma10:null,alert:false});
  }
  const sorted=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
  sorted.forEach((row,i)=>{
    const window=sorted.slice(Math.max(0,i-9),i+1).map(r=>r.ratio);
    row.ma10=window.length===10&&window.every(v=>v!==null)?window.reduce<number>((sum,v)=>sum+v!,0)/10:null;
    row.alert=row.ma10!==null&&row.ma10>2;
  });
  return {status:'ok',asOf:last[0],collectedAt:now.toISOString(),error:null,rows:sorted.slice(-3000),kind:last[0]===today&&minute<900?'intraday':'final'};
}
