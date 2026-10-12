import type { FlowReport } from './boards';
/** Five-minute interval starts; retain the latest real sample in each interval. */
export function flowGrid(report: FlowReport, now = new Date()): FlowReport {
  if (report.resolution === 'close') return report;
  const day = report.asOf.slice(0,10);
  const times = Array.from({length:67}, (_,i) => {
    const minute = 570+i*5;
    return `${day} ${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  });
  const samples = report.times.map((time,i)=>({time,i})).sort((a,b)=>a.time.localeCompare(b.time));
  return {...report,times,boards:report.boards.map(board=>{
    const values: (number|null)[] = times.map(()=>null);
    for(const {time,i} of samples) {
      const minute = Number(time.slice(11,13))*60+Number(time.slice(14,16));
      if(time.slice(0,10)!==day || Date.parse(time.replace(' ','T')+':00+08:00')>now.getTime() ||
        !((minute>=570&&minute<=690)||(minute>=780&&minute<=900))) continue;
      if(board.values[i] != null) values[Math.floor((minute-570)/5)]=board.values[i];
    }
    return {...board,values};
  })};
}
