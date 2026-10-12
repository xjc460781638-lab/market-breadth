/** Render every selected heatmap row/column, including cells outside the scroll viewport. */
export function downloadHeatmap(table: HTMLTableElement, title: string) {
  const rows = Array.from(table.rows);
  const widths = Array.from(rows[0].cells, (_, i) => i === 0 ? 100 : 76);
  const width = widths.reduce((sum, value) => sum + value, 0) + 40;
  const height = rows.length * 30 + 108;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);
  ctx.fillStyle = "#081522";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#d5eafa";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(title, 20, 34);
  ctx.font = "13px sans-serif";
  ctx.fillText("绿 → 白 → 红：低宽度 → 高宽度 · 缺失显示 — · 严格高于 MA20", 20, 58);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  rows.forEach((row, r) => {
    let x = 20;
    Array.from(row.cells).forEach((cell, c) => {
      const style = getComputedStyle(cell);
      const y = 76 + r * 30;
      ctx.fillStyle = r === 0 || c === 0 ? "#10283b" : style.backgroundColor;
      ctx.fillRect(x, y, widths[c] - 1, 29);
      ctx.fillStyle = r === 0 || c === 0 ? "#d5eafa" : style.color;
      ctx.fillText(cell.innerText.trim(), x + widths[c] / 2, y + 15, widths[c] - 4);
      x += widths[c];
    });
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = title.replace(/[\\/:*?"<>|]/g, "-") + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, "image/png");
}
