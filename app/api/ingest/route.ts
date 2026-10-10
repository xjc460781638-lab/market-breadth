import { env } from "cloudflare:workers";
import { authorizedCollector } from "../../../lib/server";
import { reportSchema } from "../../../lib/breadth";
export async function POST(request: Request) {
  if (!(await authorizedCollector(request)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB)
    return Response.json({ error: "Storage unavailable" }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 1500000)
    return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 1500000)
    return new Response("Too large", { status: 413 });
  let parsed;
  try {
    parsed = reportSchema.safeParse(JSON.parse(body));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!parsed.success)
    return Response.json(
      { error: "Invalid report", issues: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  const r = parsed.data;
  if (Date.parse(r.collectedAt) > Date.now() + 300000)
    return new Response("Future timestamp", { status: 400 });
  const payload = JSON.stringify(r);
  await env.DB.prepare(
    `INSERT INTO snapshots(id,revision,collected_at,payload) VALUES('latest',?,?,?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,collected_at=excluded.collected_at,payload=excluded.payload
    WHERE excluded.collected_at>snapshots.collected_at`,
  )
    .bind(r.revision, r.collectedAt, payload)
    .run();
  const current = await env.DB.prepare(
    "SELECT revision FROM snapshots WHERE id='latest'",
  ).first<{ revision: string }>();
  if (current?.revision !== r.revision)
    return Response.json({ error: "Older report rejected" }, { status: 409 });
  await env.BUCKET?.put("latest.json", payload, {
    httpMetadata: { contentType: "application/json" },
  });
  return Response.json({ revision: r.revision });
}
