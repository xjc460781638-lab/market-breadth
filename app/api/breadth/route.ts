import { getChatGPTUser } from "../../chatgpt-auth";
import { latest } from "../../../lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await getChatGPTUser()))
    return Response.json({ error: "请登录后查看" }, { status: 401 });
  const row = await latest();
  return Response.json(
    row ? JSON.parse(row.payload) : { status: "awaiting-data" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
