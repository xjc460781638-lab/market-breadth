import { z } from "zod";
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num=z.number().finite();
const meta={status:z.enum(['ok','error']),asOf:z.string().max(30).nullable(),collectedAt:z.string().datetime({offset:true}).nullable(),error:z.string().max(200).nullable()};
export const analyticsSchema=z.object({schemaVersion:z.literal(1),revision:z.string().regex(/^[a-f0-9]{24}$/),collectedAt:z.string().datetime({offset:true}),calendar:z.array(date).max(1500),
 turnover:z.object({...meta,rows:z.array(z.object({date,csiAmount:num.nonnegative().nullable(),hsAmount:num.nonnegative().nullable(),ratio:num.nonnegative().nullable(),ma10:num.nonnegative().nullable(),alert:z.boolean()})).max(3000)}),
 flow:z.object({...meta,rows:z.array(z.object({time:z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),main:num,super:num,large:num,medium:num,small:num})).max(300)}),
 margin:z.object({...meta,rows:z.array(z.object({date,balance:num.nonnegative(),financing:num.nonnegative(),securities:num.nonnegative(),index:num.positive()})).max(500)})
}).strict();
export type Analytics=z.infer<typeof analyticsSchema>;
export function flowState(data:Analytics,now=new Date()) {
 const local=new Date(now.getTime()+8*3600000).toISOString();const day=local.slice(0,10);const minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));
 const trading=data.calendar.includes(day)&&((minute>=570&&minute<=690)||(minute>=780&&minute<=900));
 const date=data.flow.asOf?.slice(0,10);
 if(!data.flow.rows.length)return '分时数据尚未就绪';
 if(date!==day)return `最近交易日 ${date} · 非今日分时`;
 if(data.flow.status==='error')return '采集失败 · 保留上次曲线';
 if(trading&&(!data.flow.collectedAt||now.getTime()-Date.parse(data.flow.collectedAt)>600000||now.getTime()-Date.parse(data.flow.asOf!.replace(' ','T')+':00+08:00')>600000))return '分时数据已过期';
 return trading?'当日分时 · 每5分钟尽力更新':'当日分时 · 非交易时段';
}
