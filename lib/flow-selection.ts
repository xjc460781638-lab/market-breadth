type Board = {code: string; net: number | null; values: (number | null)[]};

export function defaultFlowSelection(boards: Board[]): string[] {
  const valid = boards.filter(b => b.net !== null && Number.isFinite(b.net) && b.values.some(v => v !== null && Number.isFinite(v)));
  const tie = (a: Board, b: Board) => a.code.localeCompare(b.code);
  const inflow = valid.filter(b => b.net! > 0).sort((a,b) => b.net! - a.net! || tie(a,b)).slice(0,5);
  const outflow = valid.filter(b => b.net! < 0).sort((a,b) => a.net! - b.net! || tie(a,b)).slice(0,5);
  return [...new Set([...inflow,...outflow].map(b => b.code))];
}
