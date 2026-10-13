import {env} from 'cloudflare:workers';
import {authorizedCollector} from '../../../../lib/server';
function isIFind(value:unknown):boolean {
  if(!value || typeof value!=='object') return false;
  const r=value as {source?:unknown;provider?:unknown;template?:{provider?:unknown}};
  return r.source==='ifind'||r.provider==='ifind'||r.template?.provider==='ifind';
}
export async function POST(request:Request) {
  if(!await authorizedCollector(request)) return new Response('Unauthorized',{status:401});
  if(request.headers.get('x-cleanup-action')!=='remove-non-ifind') return new Response('Explicit action required',{status:400});
  if(!env.DB||!env.BUCKET) return new Response('Storage unavailable',{status:503});
  const rows=await env.DB.prepare('SELECT id,payload,revision FROM snapshots').all<{id:string;payload:string;revision:string}>();
  let databaseDeleted=0,objectsDeleted=0;
  for(const row of rows.results) {
    let keep=false;try{keep=isIFind(JSON.parse(row.payload));}catch{}
    if(!keep) {
      const r=await env.DB.prepare('DELETE FROM snapshots WHERE id=? AND revision=?').bind(row.id,row.revision).run();
      databaseDeleted+=r.meta.changes??0;
    }
  }
  let cursor:string|undefined;
  do {
    const page=await env.BUCKET.list({cursor,limit:100});
    for(const object of page.objects) {
      if(!/^(latest\.json|analytics\.json|breadth-basis-[\d-]+\.json|flow-(concept|industry|index).*\.json)$/.test(object.key)) continue;
      const value=await env.BUCKET.get(object.key);
      if(!value)continue;
      let keep=false;try{keep=isIFind(await value.json());}catch{}
      if(!keep){await env.BUCKET.delete(object.key);objectsDeleted++;}
    }
    cursor=page.truncated?page.cursor:undefined;
  } while(cursor);
  const remaining=await env.DB.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE coalesce(json_extract(payload,\'$.provider\'),json_extract(payload,\'$.source\'),\'\')!=\'ifind\'').first<{count:number}>();
  return Response.json({databaseDeleted,objectsDeleted,remainingLegacyRows:remaining?.count},{headers:{'Cache-Control':'no-store'}});
}
