import type { FlowReport } from './boards';
export type CurveInput={code:string;data:{code?:string;market?:number;klines?:unknown[]}};
/** User-requested removal of the identified legacy manual snapshots, not genuine minute curves. */
export function removeLegacySnapshots(report:FlowReport):FlowReport {
  const stamp=report.kind==='flow-industry'?'2026-10-12 10:27':report.kind==='flow-index'?'2026-10-12 10:28':null;
  if(!stamp||report.resolution==='close') return report;
  return {...report,boards:report.boards.map(board=>{
    const indices=board.values.flatMap((value,i)=>value===null?[]:[i]);
    if(indices.length!==1||report.times[indices[0]]!==stamp) return board;
    return {...board,values:board.values.map(()=>null),net:null,asOf:null,error:'单次快照已移除，等待真实分时数据'};
  })};
}
export function retainFlowHistory(previous:FlowReport,incoming:FlowReport):FlowReport {
  previous=removeLegacySnapshots(previous);incoming=removeLegacySnapshots(incoming);
  if(incoming.asOf.slice(0,10)<previous.asOf.slice(0,10)) return {...previous,revision:incoming.revision,collectedAt:incoming.collectedAt};
  if(previous.resolution==='close'||incoming.resolution==='close'||previous.asOf.slice(0,10)!==incoming.asOf.slice(0,10)) return incoming;
  const times=[...new Set([...previous.times,...incoming.times])].sort();
  const old=new Map(previous.boards.map(b=>[b.code,b]));
  const boards=incoming.boards.map(b=>{
    const prior=old.get(b.code);
    const points=new Map(previous.times.map((t,i)=>[t,prior?.values[i]??null]));
    incoming.times.forEach((t,i)=>{if(b.values[i]!==null)points.set(t,b.values[i]);});
    const last=times.filter(t=>points.get(t)!=null).at(-1);
    return {...b,values:times.map(t=>points.get(t)??null),asOf:last??null,net:last?points.get(last)!:null};
  });
  return {...incoming,asOf:times.at(-1)??incoming.asOf,times,boards};
}
export function mergeCurves(previous:FlowReport,curves:CurveInput[],now=new Date()):{report:FlowReport;updated:number} {
  previous=removeLegacySnapshots(previous);
  const day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  const known=new Set(previous.boards.map(b=>b.code));
  const incoming=new Map<string,Map<string,number>>();
  for(const curve of curves) {
    if(!known.has(curve.code)||`${curve.data?.market}.${curve.data?.code}`!==curve.code||!Array.isArray(curve.data?.klines)||curve.data.klines.length>300) continue;
    const points=new Map<string,number>();
    for(const raw of curve.data.klines) {
      if(typeof raw!=='string') continue;
      const [time,value]=raw.split(',');
      if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time)||!time.startsWith(day)||!value?.trim()||!Number.isFinite(Number(value))) continue;
      const minute=Number(time.slice(11,13))*60+Number(time.slice(14,16));
      if(!((minute>=570&&minute<=690)||(minute>=780&&minute<=900))||Date.parse(time.replace(' ','T')+':00+08:00')>now.getTime()) continue;
      points.set(time,Math.round(Number(value)/1e4)/1e4);
    }
    if(points.size) incoming.set(curve.code,points);
  }
  if(!incoming.size) throw Error('分时接口未返回今日有效序列，已保留已有数据');
  const keep=previous.resolution!=='close'&&previous.asOf.startsWith(day);
  const times=[...new Set([...(keep?previous.times:[]),...[...incoming.values()].flatMap(p=>[...p.keys()])])].sort();
  const boards=previous.boards.map(b=>{
    const points=new Map<string,number|null>(keep?previous.times.map((t,i)=>[t,b.values[i]]):[]);
    for(const [time,value] of incoming.get(b.code)??[]) points.set(time,value);
    const valid=[...points].filter(([,v])=>v!==null).sort(([a],[b])=>a.localeCompare(b));
    const last=valid.at(-1);
    return {...b,values:times.map(t=>points.get(t)??null),net:last?.[1]??null,asOf:last?.[0]??null,error:incoming.has(b.code)?null:(keep?b.error:'等待补齐当日分时')};
  });
  return {updated:incoming.size,report:{...previous,resolution:'minute',collectedAt:now.toISOString(),asOf:times.at(-1)!,times,boards}};
}
