import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { boardKindSchema, flowReportSchema } from "../../../../lib/boards";
import { mergeQuotes, quoteFromRow, type Quote } from "../../../../lib/flow-refresh";

export async function POST(request: Request) {
  const reply = (message:string,status:number) => Response.json({message},{status,headers:{"Cache-Control":"no-store"}});
  if (!(await getChatGPTUser())) return reply("请先登录网站",401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply("请求来源无效",403);
  const kind = boardKindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return reply("板块类型无效",400);
  if (!env.DB) return reply("存储暂不可用",503);
  const row = await env.DB.prepare("SELECT payload FROM snapshots WHERE id=? OR id LIKE ? ORDER BY (id=?) DESC, id DESC LIMIT 1")
    .bind(kind.data,`${kind.data}:close:%`,kind.data).first<{payload:string}>();
  if (!row) return reply("尚无板块目录，请等待初始化",503);
  const previous = flowReportSchema.parse(JSON.parse(row.payload));
  const now = new Date();
  // Atomic per-category cooldown also prevents concurrent button requests across tabs/devices.
  const lock = await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,'refresh',?,'{}') ON CONFLICT(id) DO UPDATE SET collected_at=excluded.collected_at WHERE snapshots.collected_at<? RETURNING id`)
    .bind(`manual-refresh:${kind.data}`,now.toISOString(),new Date(now.getTime()-60000).toISOString()).first();
  if (!lock) return reply("刚刚已发起采集，请等待一分钟再试",429);
  const batches = Array.from({length:Math.ceil(previous.boards.length/50)},(_,i)=>previous.boards.slice(i*50,i*50+50));
  const quotes: Quote[] = [];
  let cursor = 0;
  await Promise.all(Array.from({length:3},async () => {
    while(cursor < batches.length) {
      const batch = batches[cursor++];
      try {
        const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
        url.search = new URLSearchParams({secids:batch.map(b=>b.code).join(","),fields:"f12,f13,f14,f62,f124",fltt:"2",invt:"2"}).toString();
        const response = await fetch(url,{headers:{"User-Agent":"Mozilla/5.0",Referer:"https://data.eastmoney.com/"},signal:AbortSignal.timeout(8000)});
        if (!response.ok) continue;
        const json = await response.json() as {data?:{diff?:Record<string,unknown>[]}};
        if (Array.isArray(json.data?.diff)) for (const raw of json.data.diff) {
          const quote = quoteFromRow(raw);
          if (quote) quotes.push(quote);
        }
      } catch { /* Partial failures must not erase successful quotes or the saved report. */ }
    }
  }));
  const report = mergeQuotes(previous,quotes);
  if (!report) return reply("行情源暂未返回有效的新数据，已保留原数据，请稍后重试",502);
  const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(report)));
  report.revision = [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,"0")).join("").slice(0,24);
  const payload = JSON.stringify(flowReportSchema.parse(report));
  const sql = `INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`;
  await env.DB.batch([kind.data,`${kind.data}:${report.asOf.slice(0,10)}`].map(id=>env.DB!.prepare(sql).bind(id,report.revision,report.collectedAt,payload)));
  const saved = await env.DB.prepare("SELECT revision FROM snapshots WHERE id=?").bind(kind.data).first<{revision:string}>();
  if(saved?.revision !== report.revision) return reply("已有更新的采集结果，请重新读取页面",409);
  const updated = report.boards.filter(b=>!b.error).length;
  const age = Date.now()-Date.parse(report.asOf.replace(" ","T")+":00+08:00");
  return Response.json({message:`已获取 ${updated}/${report.boards.length} 个板块，行情时间 ${report.asOf}${age>600000 ? "；源数据仍较旧，尚未恢复实时行情" : ""}`,asOf:report.asOf},{headers:{"Cache-Control":"no-store"}});
}
