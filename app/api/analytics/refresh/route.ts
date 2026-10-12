import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { analyticsSchema } from '../../../../lib/analytics';
import { refreshTurnover } from '../../../../lib/turnover-refresh';
const reply=(message:string,status:number)=>Response.json({message},{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request) {
  if(!await getChatGPTUser()) return reply('请先登录网站',401);
  if(request.headers.get('origin')!==new URL(request.url).origin) return reply('请求来源无效',403);
  if(!env.DB) return reply('存储暂不可用',503);
  if(Number(request.headers.get('content-length')??0)>100000) return reply('数据过大',413);
  const body=await request.text();
  if(new TextEncoder().encode(body).length>100000) return reply('数据过大',413);
  let histories;
  try { histories=JSON.parse(body).histories; if(!Array.isArray(histories)||histories.length!==2) throw Error(); }
  catch { return reply('行情格式不正确',400); }
  for(let attempt=0;attempt<3;attempt++) {
    const row=await env.DB.prepare("SELECT payload,revision FROM snapshots WHERE id='analytics'").first<{payload:string;revision:string}>();
    if(!row) return reply('历史数据尚未就绪',503);
    const report=analyticsSchema.parse(JSON.parse(row.payload));
    if(report.turnover.collectedAt&&Date.now()-Date.parse(report.turnover.collectedAt)<15000) return reply('刚刚已刷新，请稍后重试',429);
    try { report.turnover=refreshTurnover(report.turnover,histories,report.calendar); }
    catch(e) { return reply(e instanceof Error?e.message:'计算失败，已保留原数据',502); }
    report.collectedAt=new Date().toISOString();
    report.revision=crypto.randomUUID().replaceAll('-','').slice(0,24);
    const saved=await env.DB.prepare("UPDATE snapshots SET payload=?,revision=?,collected_at=? WHERE id='analytics' AND revision=? RETURNING revision").bind(JSON.stringify(analyticsSchema.parse(report)),report.revision,report.collectedAt,row.revision).first();
    if(saved) return Response.json({report,message:`已获取 ${report.turnover.asOf} 成交额 · ${report.turnover.kind==='intraday'?'盘中累计估算':'日终数据'}`},{headers:{'Cache-Control':'no-store'}});
  }
  return reply('数据正在更新，请重试',409);
}
