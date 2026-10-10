import { env } from "cloudflare:workers";
import { authorizedCollector } from "../../../../lib/server";
import { boardKindSchema } from "../../../../lib/boards";
export async function GET(request: Request) {
  if (!(await authorizedCollector(request)))
    return new Response("Unauthorized", { status: 401 });
  const kind = boardKindSchema.safeParse(
    new URL(request.url).searchParams.get("kind"),
  );
  if (!kind.success) return new Response("Invalid kind", { status: 400 });
  const row = await env.DB?.prepare("SELECT revision FROM snapshots WHERE id=?")
    .bind(kind.data)
    .first<{ revision: string }>();
  return Response.json(
    { revision: row?.revision ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
