import { z } from 'zod';
const cell = z.object({value:z.number().finite().nullable(),above:z.number().int().nonnegative().nullable(),total:z.number().int().nonnegative()});
export const reportSchema = z.object({
  schemaVersion:z.literal(1), revision:z.string().regex(/^[a-f0-9]{24}$/),
  asOf:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),collectedAt:z.string().datetime({offset:true}),
  sourceAsOf:z.string().nullable(),quoteTimeRange:z.array(z.string()).length(2).nullable(),
  kind:z.enum(['intraday','final']),window:z.literal(20),historyDays:z.literal(250),
  industries:z.array(z.object({code:z.string().regex(/^\d{6}$/),name:z.string().min(1).max(40)})).min(28).max(50),
  rows:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),values:z.record(cell)})).length(250),
  eligibleStocks:z.number().int().min(1000),universeStocks:z.number().int().min(1000),
  coverage:z.number().min(0).max(100),failedStocks:z.number().int().nonnegative(),excludedStocks:z.number().int().nonnegative(),
  industryAsOf:z.string(),calendar:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(270).max(1000),
  source:z.string().max(300),notes:z.array(z.string().max(300)).max(20),
}).superRefine((r,ctx)=>{
  if(r.rows[0].date!==r.asOf || r.eligibleStocks>r.universeStocks || new Set(r.rows.map(x=>x.date)).size!==250)
    ctx.addIssue({code:'custom',message:'Inconsistent report dates or population'});
  if (new Set(r.industries.map(x=>x.code)).size!==r.industries.length) ctx.addIssue({code:'custom',message:'Duplicate industries'});
  const codes=[...r.industries.map(x=>x.code),'market','sum'];
  r.rows.forEach((row,i)=>{
    if(i && row.date>=r.rows[i-1].date) ctx.addIssue({code:'custom',message:'Dates must descend'});
    codes.forEach(code=>{
      const c=row.values[code];
      if(!c || (c.value!==null && (!Number.isInteger(c.value) || c.value<0 || c.value>(code==='sum'?r.industries.length*100:100))) || (c.above!==null&&c.above>c.total))
        ctx.addIssue({code:'custom',message:'Invalid breadth cell'});
    });
  });
});
export type Report = z.infer<typeof reportSchema>;
export function freshness(report:Report, now=new Date()): 'live'|'closed'|'stale' {
  const cn=new Date(now.getTime()+8*3600000);
  const day=cn.toISOString().slice(0,10), m=cn.getUTCHours()*60+cn.getUTCMinutes();
  if(!report.calendar.includes(day)) return day>report.calendar[report.calendar.length-1]?'stale':'closed';
  const session=(m>=575&&m<=690)||(m>=785&&m<=900);
  if(!session) return 'closed';
  return report.kind==='intraday'&&report.asOf===day&&now.getTime()-Date.parse(report.collectedAt)<=600000?'live':'stale';
}
