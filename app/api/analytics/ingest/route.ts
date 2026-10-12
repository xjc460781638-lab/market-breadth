import { env } from "cloudflare:workers";
import { authorizedCollector } from "../../../../lib/server";
import { analyticsSchema } from "../../../../lib/analytics";
export async function POST(request: Request) {
  if (!(await authorizedCollector(request)))
    return new Response("Unauthorized", { status: 401 });
  if (!env.DB) return new Response("Storage unavailable", { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 1500000)
    return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 1500000)
    return new Response("Too large", { status: 413 });
  let r;
  try {
    r = analyticsSchema.parse(JSON.parse(body));
  } catch {
    return new Response("Invalid analytics report", { status: 400 });
  }
  if (Date.parse(r.collectedAt) > Date.now() + 300000)
    return new Response("Future timestamp", { status: 400 });
  const payload = JSON.stringify(r);
  await env.DB.prepare(
    `INSERT INTO snapshots(id,revision,collected_at,payload) VALUES('analytics',?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=CASE WHEN json_extract(snapshots.payload,'$.turnover.asOf')>json_extract(excluded.payload,'$.turnover.asOf') OR julianday(json_extract(snapshots.payload,'$.turnover.collectedAt'))>julianday(json_extract(excluded.payload,'$.turnover.collectedAt')) THEN json_set(excluded.payload,'$.turnover',json_extract(snapshots.payload,'$.turnover')) ELSE excluded.payload END WHERE julianday(excluded.collected_at)>julianday(snapshots.collected_at)`,
  )
    .bind(r.revision, r.collectedAt, payload)
    .run();
  const current = await env.DB.prepare(
    "SELECT revision,payload FROM snapshots WHERE id='analytics'",
  ).first<{ revision: string; payload:string }>();
  if (current?.revision !== r.revision)
    return new Response("Older report rejected", { status: 409 });
  await env.BUCKET?.put("analytics.json", current.payload, {
    httpMetadata: { contentType: "application/json" },
  });
  return Response.json({ revision: r.revision });
}
