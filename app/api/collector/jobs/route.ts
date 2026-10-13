import {env} from 'cloudflare:workers';
import {authorizedCollector} from '../../../../lib/server';
async function heartbeat() {
  await env.DB!.prepare("INSERT INTO collector_state VALUES('local',?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat").bind(new Date().toISOString()).run();
}
export async function GET(request:Request) {
  if(!await authorizedCollector(request))return new Response('Unauthorized',{status:401});
  if(!env.DB)return new Response('Unavailable',{status:503});
  await heartbeat();
  const lease=crypto.randomUUID(),time=new Date().toISOString();
  const job=await env.DB.prepare("UPDATE refresh_jobs SET status='running',lease=?,updated_at=?,message='本机正在增量采集并保存 iFinD 数据' WHERE id=(SELECT id FROM refresh_jobs WHERE status='queued' OR (status='running' AND updated_at<?) ORDER BY created_at LIMIT 1) RETURNING id,scope,request,lease").bind(lease,time,new Date(Date.now()-600000).toISOString()).first();
  return Response.json({job},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  if(!await authorizedCollector(request))return new Response('Unauthorized',{status:401});
  if(!env.DB)return new Response('Unavailable',{status:503});
  await heartbeat();
  const body=await request.json() as {id?:string;lease?:string;status?:string;message?:string};
  if(body.id) {
    if(!['running','done','error'].includes(body.status??''))return new Response('Invalid status',{status:400});
    const result=await env.DB.prepare('UPDATE refresh_jobs SET status=?,message=?,updated_at=? WHERE id=? AND lease=? AND status=\'running\'').bind(body.status,(body.message??'').slice(0,300),new Date().toISOString(),body.id,body.lease).run();
    if(!result.meta.changes)return new Response('Lease lost',{status:409});
  }
  return Response.json({ok:true});
}
