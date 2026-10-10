import {env} from 'cloudflare:workers';
import {authorizedCollector} from '../../../../lib/server';
export async function GET(request:Request){
 if(!(await authorizedCollector(request)))return new Response('Unauthorized',{status:401});
 const row=await env.DB?.prepare("SELECT revision FROM snapshots WHERE id='analytics'").first<{revision:string}>();
 return Response.json({revision:row?.revision??null},{headers:{'Cache-Control':'no-store'}});
}
