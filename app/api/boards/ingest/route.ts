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
  await env.DB.prepare(
    `INSERT INTO snapshots(id,revision,collected_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload WHERE excluded.collected_at>snapshots.collected_at`,
  )
    .bind(r.kind, r.revision, r.collectedAt, payload)
    .run();
  const current = await env.DB.prepare(
    "SELECT revision FROM snapshots WHERE id=?",
  )
    .bind(r.kind)
    .first<{ revision: string }>();
  if (current?.revision !== r.revision)
    return new Response("Older report rejected", { status: 409 });
  await env.BUCKET?.put(r.kind + ".json", payload, {
    httpMetadata: { contentType: "application/json" },
  });
  return Response.json({ revision: r.revision });
}
