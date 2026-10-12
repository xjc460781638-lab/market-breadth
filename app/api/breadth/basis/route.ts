import { env } from "cloudflare:workers";
import { authorizedCollector } from "../../../../lib/server";
import { basisSchema } from "../../../../lib/breadth-refresh";
export async function POST(request:Request) {
  if(!await authorizedCollector(request)) return new Response("Unauthorized",{status:401});
  if(!env.BUCKET) return new Response("Storage unavailable",{status:503});
  if(Number(request.headers.get("content-length")??0)>4000000) return new Response("Too large",{status:413});
  const text=await request.text();
  if(new TextEncoder().encode(text).length>4000000) return new Response("Too large",{status:413});
  let basis;
  try { basis=basisSchema.parse(JSON.parse(text)); } catch { return new Response("Invalid basis",{status:400}); }
  const key=`breadth-basis-${basis.day}.json`;
  await env.BUCKET.put(key,JSON.stringify(basis),{httpMetadata:{contentType:"application/json"}});
  const saved=await env.BUCKET.get(key);
  const value=saved ? await saved.json<{revision:string}>() : null;
  return Response.json({revision:value?.revision},{status:value?.revision===basis.revision ? 200 : 500});
}
