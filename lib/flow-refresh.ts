import type { FlowReport } from "./boards";

export type Quote = { code: string; time: string; net: number };
export function quoteFromRow(row: Record<string, unknown>, now = Date.now()): Quote | null {
  if (typeof row.f62 !== "number" || !Number.isFinite(row.f62) || typeof row.f124 !== "number") return null;
  const stamp = row.f124 * 1000;
  if (!Number.isFinite(stamp) || stamp < 946684800000 || stamp > now + 300000) return null;
  const code = String(row.f12).startsWith("BK") ? "90." + row.f12 : `${row.f13}.${row.f12}`;
  return { code, time: new Date(stamp + 8 * 3600000).toISOString().slice(0,16).replace("T", " "), net: Math.round(row.f62 / 1e4) / 1e4 };
}

export function mergeQuotes(previous: FlowReport, quotes: Quote[], now = new Date()): FlowReport | null {
  const known = new Set(previous.boards.map(b => b.code));
  const usable = quotes.filter(q => known.has(q.code) && (q.time > previous.asOf || (q.time === previous.asOf && previous.resolution !== "close")));
  if (!usable.length) return null;
  const asOf = usable.map(q => q.time).sort().at(-1)!;
  const day = asOf.slice(0,10);
  const current = new Map(usable.filter(q => q.time.startsWith(day)).map(q => [q.code,q]));
  const keep = previous.resolution !== "close" && previous.asOf.startsWith(day);
  const times = [...new Set([...(keep ? previous.times : []), ...[...current.values()].map(q => q.time)])].sort().slice(-300);
  const boards = previous.boards.map(b => {
    const q = current.get(b.code);
    const points = new Map(keep ? previous.times.map((t,i) => [t,b.values[i]] as const) : []);
    if (q) points.set(q.time,q.net);
    return {...b, asOf:q?.time ?? (keep ? b.asOf : null), net:q?.net ?? (keep ? b.net : null),
      values:times.map(t => points.get(t) ?? null), error:q ? null : "本次未取得行情，保留已有有效数据"};
  });
  return {...previous, resolution:"minute", collectedAt:now.toISOString(), asOf,times,boards};
}
