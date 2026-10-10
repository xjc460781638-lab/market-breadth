import {authorizedCollector,latest} from '../../../../lib/server';
export async function GET(request:Request){
  if(!await authorizedCollector(request)) return new Response('Unauthorized',{status:401});
  const row=await latest();
  return Response.json({revision:row?.revision??null},{headers:{'Cache-Control':'no-store'}});
}
