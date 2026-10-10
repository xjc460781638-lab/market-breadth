import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
export const dynamic='force-dynamic';
export async function GET(){
 if(!(await getChatGPTUser()))return new Response('Unauthorized',{status:401});
 const row=await env.DB?.prepare("SELECT payload FROM snapshots WHERE id='analytics'").first<{payload:string}>();
 return Response.json(row?JSON.parse(row.payload):{status:'awaiting-data'},{headers:{'Cache-Control':'no-store'}});
}
