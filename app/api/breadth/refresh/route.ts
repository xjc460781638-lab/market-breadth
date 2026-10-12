import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { basisSchema,calculateRefresh,parseBreadthQuote } from "../../../../lib/breadth-refresh";
import { reportSchema } from "../../../../lib/breadth";
const reply=(message:string,status:number)=>Response.json({message},{status,headers:{"Cache-Control":"no-store"}});
async function basisForToday() {
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const object=await env.BUCKET?.get(`breadth-basis-${today}.json`);
  return object ? basisSchema.parse(await object.json()) : null;
}
export async function GET() {
  if(!await getChatGPTUser()) return reply("请先登录网站",401);
  const basis=await basisForToday();
  if(!basis) return reply("今日的历史行情基准尚未就绪，无法可靠计算 MA20；已保留原结果",503);
  return Response.json({day:basis.day,revision:basis.revision,codes:basis.stocks.map(s=>s.code)},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request) {
  if(!await getChatGPTUser()) return reply("请先登录网站",401);
  if(request.headers.get("origin")!==new URL(request.url).origin) return reply("请求来源无效",403);
  if(!env.DB) return reply("存储暂不可用",503);
  const basis=await basisForToday();
  if(!basis) return reply("历史行情基准未就绪，已保留原结果",503);
  const cn=new Date(Date.now()+8*3600000),minute=cn.getUTCHours()*60+cn.getUTCMinutes();
  if(!basis.template.calendar.includes(basis.day) || minute<570) return reply("今日尚未开盘或不是交易日，请查看最近有效结果",409);
  if(Number(request.headers.get("content-length")??0)>1500000) return reply("行情数据过大",413);
  const text=await request.text();
  if(new TextEncoder().encode(text).length>1500000) return reply("行情数据过大",413);
  let input:{revision:string;rows:Record<string,unknown>[]};
  try {
    input=JSON.parse(text);
    if(input.revision!==basis.revision || !Array.isArray(input.rows) || input.rows.length>7000 || input.rows.some(r=>!r||typeof r!=="object")) throw Error();
  } catch { return reply("行情格式或计算基准已变更，请重试",400); }
  const now=new Date();
  const lock=await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES('manual-refresh:breadth','refresh',?,'{}') ON CONFLICT(id) DO UPDATE SET collected_at=excluded.collected_at WHERE snapshots.collected_at<? RETURNING id`).bind(now.toISOString(),new Date(now.getTime()-60000).toISOString()).first();
  if(!lock) return reply("刚刚已刷新，请一分钟后再试",429);
  let report;
  try { report=calculateRefresh(basis,input.rows.flatMap(row=>{const q=parseBreadthQuote(row,basis.day);return q ? [q] : [];}),now); }
  catch(e) { return reply(e instanceof Error ? e.message : "计算失败，已保留原结果",502); }
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(report)));
  report.revision=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("").slice(0,24);
  const payload=JSON.stringify(reportSchema.parse(report));
  await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES('latest',?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`).bind(report.revision,report.collectedAt,payload).run();
  const saved=await env.DB.prepare("SELECT revision FROM snapshots WHERE id='latest'").first<{revision:string}>();
  if(saved?.revision!==report.revision) return reply("已有更新结果，请重新读取页面",409);
  return Response.json({report,message:`已重新计算行业宽度 · 有效 ${report.eligibleStocks}/${report.universeStocks} 只 · 覆盖 ${report.coverage}% · 行情 ${report.quoteTimeRange?.[1]}`},{headers:{"Cache-Control":"no-store"}});
}
