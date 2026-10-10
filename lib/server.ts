import { env } from "cloudflare:workers";
export async function authorizedCollector(request: Request) {
  if (!env.INGEST_TOKEN) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.INGEST_TOKEN}`;
  const a = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
  );
  const b = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  );
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
export async function latest() {
  return env.DB?.prepare(
    "SELECT revision,payload FROM snapshots WHERE id='latest'",
  ).first<{ revision: string; payload: string }>();
}
