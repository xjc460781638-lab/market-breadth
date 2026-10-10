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
  const row = await env.DB?.prepare("SELECT payload FROM snapshots WHERE id=?")
    .bind(kind.data)
    .first<{ payload: string }>();
  return Response.json(
    row ? JSON.parse(row.payload) : { status: "awaiting-data" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
