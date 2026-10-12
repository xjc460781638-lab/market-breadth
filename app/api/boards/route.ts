import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { boardKindSchema } from "../../../lib/boards";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await getChatGPTUser()))
    return new Response("Unauthorized", { status: 401 });
  const kind = boardKindSchema.safeParse(
    new URL(request.url).searchParams.get("kind"),
  );
  if (!kind.success) return new Response("Invalid kind", { status: 400 });
  const date = new URL(request.url).searchParams.get("date");
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !kind.data.startsWith("flow-")))
    return new Response("Invalid date", { status: 400 });
  const latest = await env.DB?.prepare("SELECT payload FROM snapshots WHERE id=? OR id LIKE ? ORDER BY json_extract(payload,'$.asOf') DESC,julianday(collected_at) DESC LIMIT 1").bind(kind.data,`${kind.data}:%`).first<{payload:string}>();
  const current = latest ? JSON.parse(latest.payload) : null;
  const dates: string[] = current ? current.calendar.filter((d: string) => d <= current.asOf.slice(0,10)).slice(-10).reverse() : [];
  let row = await env.DB?.prepare("SELECT payload FROM snapshots WHERE id=?")
    .bind(date ? `${kind.data}:close:${date}` : kind.data)
    .first<{ payload: string }>();
  if (!date) row = latest;
  if (!row) row = date ? await env.DB?.prepare("SELECT payload FROM snapshots WHERE id=?").bind(`${kind.data}:${date}`).first<{payload:string}>() : latest;
  return Response.json(
    row ? JSON.parse(row.payload) : { status: date ? "no-history" : "awaiting-data" },
    { headers: { "Cache-Control": "no-store", "X-Flow-Dates": dates.join(",") } },
  );
}
