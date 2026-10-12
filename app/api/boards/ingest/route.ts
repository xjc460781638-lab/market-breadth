import { env } from "cloudflare:workers";
import { authorizedCollector } from "../../../../lib/server";
import { boardReportSchema } from "../../../../lib/boards";
export async function POST(request: Request) {
  if (!(await authorizedCollector(request)))
    return new Response("Unauthorized", { status: 401 });
  if (!env.DB) return new Response("Storage unavailable", { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 1800000)
    return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 1800000)
    return new Response("Too large", { status: 413 });
  let r;
  try {
    r = boardReportSchema.parse(JSON.parse(body));
  } catch {
    return new Response("Invalid board report", { status: 400 });
  }
  if (Date.parse(r.collectedAt) > Date.now() + 300000)
    return new Response("Future timestamp", { status: 400 });
  const payload = JSON.stringify(r);
  const archive = new URL(request.url).searchParams.get("archive") === "1";
  if (archive && !r.kind.startsWith("flow-")) return new Response("Invalid archive", {status:400});
  const storageId = archive ? `${r.kind}:close:${r.asOf.slice(0,10)}` : r.kind;
  await env.DB.prepare(
    `INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`,
  )
    .bind(storageId, r.revision, r.collectedAt, payload)
    .run();
  const current = await env.DB.prepare(
    "SELECT revision FROM snapshots WHERE id=?",
  )
    .bind(storageId)
    .first<{ revision: string }>();
  if (current?.revision !== r.revision)
    return new Response("Older report rejected", { status: 409 });
  if (!archive && r.kind.startsWith("flow-")) {
    const date = r.asOf.slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Invalid date", {status:400});
    await env.DB.prepare(`INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`)
      .bind(`${r.kind}:${date}`, r.revision, r.collectedAt, payload).run();
  }
  await env.BUCKET?.put(storageId + ".json", payload, {
    httpMetadata: { contentType: "application/json" },
  });
  return Response.json({ revision: r.revision });
}
