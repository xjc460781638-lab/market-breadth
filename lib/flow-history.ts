import type {FlowReport} from './boards';
export function retainFlowHistory(previous:FlowReport,incoming:FlowReport):FlowReport {
  if(previous.source!=='ifind') return incoming;
  if(previous.asOf.slice(0,10)!==incoming.asOf.slice(0,10)) return incoming;
  const times=[...new Set([...previous.times,...incoming.times])].sort();
  const old=new Map(previous.boards.map(b=>[b.code,b]));
  return {...incoming,times,boards:incoming.boards.map(b=>{
    const prior=old.get(b.code);
    const values=new Map(previous.times.map((t,i)=>[t,prior?.values[i]??null]));
    incoming.times.forEach((t,i)=>{if(b.values[i]!==null)values.set(t,b.values[i]);});
    const last=times.filter(t=>values.get(t)!==null&&values.get(t)!==undefined).at(-1);
    return {...b,values:times.map(t=>values.get(t)??null),net:last?values.get(last)!:null,asOf:last??null};
  })};
}
