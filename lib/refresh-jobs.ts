import { env } from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {authorizedCollector} from './server';
export async function queueRefresh(request:Request,scope:string) {
  if(!await getChatGPTUser() && !await authorizedCollector(request)) return Response.json({message:'请登录后刷新'},{status:401});
  if(!env.DB)return Response.json({message:'存储暂不可用'},{status:503});
  const url=new URL(request.url);
  const day=url.searchParams.get('date');
  const codes=(url.searchParams.get('codes')||'').split(',').filter(Boolean);
  if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day)||codes.length>500||codes.some(c=>!/^\d{6}\.(TI|SH|SZ|CSI)$/.test(c)))return Response.json({message:'无效的日期或代码'},{status:400});
  const heartbeat=await env.DB.prepare("SELECT heartbeat FROM collector_state WHERE id='local'").first<{heartbeat:string}>();
  if(!heartbeat||Date.now()-Date.parse(heartbeat.heartbeat)>90000)return Response.json({message:'本机采集器未在线，请启动本机 iFinD 采集器后重试；已有历史缓存仍可查看。'},{status:503});
  const payload=JSON.stringify({day,selected:codes.length?codes:null});
  const existing=await env.DB.prepare("SELECT id,status,message FROM refresh_jobs WHERE scope=? AND request=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").bind(scope,payload).first();
  if(existing)return Response.json(existing,{status:202});
  const id=crypto.randomUUID(),time=new Date().toISOString();
  await env.DB.prepare("INSERT INTO refresh_jobs(id,scope,request,status,created_at,updated_at,message) VALUES(?,?,?,'queued',?,?,?)").bind(id,scope,payload,time,time,'已提交到本机：复用历史缓存，只获取新增或缺失数据').run();
  return Response.json({id,status:'queued',message:'已提交到本机，正在获取同花顺数据…'},{status:202});
}
