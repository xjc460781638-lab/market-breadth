import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { boardKindSchema,flowReportSchema } from '../../../../lib/boards';
import { mergeCurves,retainFlowHistory,type CurveInput } from '../../../../lib/flow-history';
export async function POST(request:Request) {
  const reply=(message:string,status:number)=>Response.json({message},{status,headers:{'Cache-Control':'no-store'}});
  if(!await getChatGPTUser()) return reply('请先登录网站',401);
  if(request.headers.get('origin')!==new URL(request.url).origin) return reply('请求来源无效',403);
  const kind=boardKindSchema.safeParse(new URL(request.url).searchParams.get('kind'));
  if(!kind.success) return reply('板块类型无效',400);
  if(!env.DB) return reply('存储暂不可用',503);
  if(Number(request.headers.get('content-length')??0)>2000000) return reply('数据过大',413);
  const body=await request.text();
  if(new TextEncoder().encode(body).length>2000000) return reply('数据过大',413);
  let curves:CurveInput[];
  try {curves=JSON.parse(body).curves;if(!Array.isArray(curves)||!curves.length||curves.length>25||curves.some(c=>!c||typeof c.code!=='string'||!c.data))throw Error();}
  catch {return reply('分时数据格式错误',400);}
  for(let attempt=0;attempt<3;attempt++) {
    const row=await env.DB.prepare('SELECT revision,payload FROM snapshots WHERE id=?').bind(kind.data).first<{revision:string;payload:string}>();
    if(!row) return reply('板块目录未就绪',503);
    let merged;
    const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    const archive=await env.DB.prepare('SELECT payload FROM snapshots WHERE id=?').bind(`${kind.data}:${day}`).first<{payload:string}>();
    try {
      const base=flowReportSchema.parse(JSON.parse(row.payload));
      merged=mergeCurves(archive?retainFlowHistory(flowReportSchema.parse(JSON.parse(archive.payload)),base):base,curves);
    }
    catch(e) {return reply(e instanceof Error?e.message:'分时合并失败',502);}
    const report=merged.report;report.revision=crypto.randomUUID().replaceAll('-','').slice(0,24);
    const payload=JSON.stringify(flowReportSchema.parse(report));
    const saved=await env.DB.prepare('UPDATE snapshots SET revision=?,collected_at=?,payload=? WHERE id=? AND revision=? RETURNING revision').bind(report.revision,report.collectedAt,payload,kind.data,row.revision).first();
    if(!saved) continue;
    await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`).bind(`${kind.data}:${report.asOf.slice(0,10)}`,report.revision,report.collectedAt,payload).run();
    return Response.json({updated:merged.updated,asOf:report.asOf,points:report.times.length},{headers:{'Cache-Control':'no-store'}});
  }
  return reply('数据正被更新，请重试',409);
}
