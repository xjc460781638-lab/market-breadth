import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {authorizedCollector} from '../../../lib/server';
export async function GET(request:Request) {
  if(!await getChatGPTUser()&&!await authorizedCollector(request))return new Response('Unauthorized',{status:401});
  const id=new URL(request.url).searchParams.get('id');
  const result=await env.DB?.prepare('SELECT id,status,message,updated_at FROM refresh_jobs WHERE id=?').bind(id).first();
  return Response.json(result??{message:'任务不存在'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});
}
