import type { FlowReport } from './boards';
type DisplayReport = Omit<FlowReport, 'boards'> & {boards: (FlowReport['boards'][number] & {sampleTimes?: (string|null)[]})[]};
/** Exact samples except the explicitly requested session-boundary fallbacks. */
export function flowGrid(report: FlowReport, now = new Date()): DisplayReport {
  if (report.resolution === 'close') return report;
  const day = report.asOf.slice(0,10);
  const times = Array.from({length:50}, (_,i) => {
    const minute = i < 25 ? 570+i*5 : 780+(i-25)*5;
    return `${day} ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  });
  const first=report.times.indexOf(day+' 13:01');
  const morningLast=report.times.indexOf(day+' 11:29');
  times.sort();
  const positions=new Map(times.map((time,i)=>[time,i]));
  const samples = report.times.map((time,i)=>({time,i})).sort((a,b)=>a.time.localeCompare(b.time));
  return {...report,times,boards:report.boards.map(board=>{
    const values: (number|null)[] = times.map(()=>null);
    const sampleTimes: (string|null)[] = times.map(()=>null);
    for(const {time,i} of samples) {
      const minute = Number(time.slice(11,13))*60+Number(time.slice(14,16));
      if(time.slice(0,10)!==day || Date.parse(time.replace(' ','T')+':00+08:00')>now.getTime() ||
        !positions.has(time) || !((minute>=570&&minute<=690)||(minute>=780&&minute<=900))) continue;
      if(board.values[i] != null) {values[positions.get(time)!]=board.values[i];sampleTimes[positions.get(time)!]=time;}
    }
    const opening=positions.get(day+' 13:00')!;
    if(values[opening]==null&&first>=0&&Date.parse(day+'T13:01:00+08:00')<=now.getTime()) {
      values[opening]=board.values[first]??null;
      if(values[opening]!=null)sampleTimes[opening]=day+' 13:01';
    }
    const closing=positions.get(day+' 11:30')!;
    if(values[closing]==null&&morningLast>=0&&Date.parse(day+'T11:30:00+08:00')<=now.getTime()) {
      values[closing]=board.values[morningLast]??null;
      if(values[closing]!=null)sampleTimes[closing]=day+' 11:29';
    }
    return {...board,values,sampleTimes};
  })};
}

/** Only request boards with missing elapsed trading nodes, prioritizing known working curves. */
export function flowCandidates(report:FlowReport,now=new Date()) {
  const day=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  if(!report.calendar.includes(day)) return [];
  const grid=flowGrid({...report,resolution:'minute',asOf:day+' 15:00'},now);
  const elapsed=grid.times.map((t,i)=>({t,i})).filter(({t})=>Date.parse(t.replace(' ','T')+':00+08:00')<=now.getTime());
  if(!elapsed.length) return [];
  const sameDay=report.resolution!=='close'&&report.asOf.startsWith(day);
  const missing=new Set(grid.boards.filter(b=>!sameDay||elapsed.some(({i})=>b.values[i]===null)).map(b=>b.code));
  return report.boards.filter(b=>missing.has(b.code)).sort((a,b)=>Number(b.values.some(v=>v!==null))-Number(a.values.some(v=>v!==null)));
}
