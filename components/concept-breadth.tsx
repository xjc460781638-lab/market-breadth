"use client";
import { useEffect, useMemo, useState } from "react";
import { conceptReportSchema, type ConceptReport } from "@/lib/boards";
import { Chart, base, download } from "./market-chart";
import type { EChartsOption } from "echarts";
export default function ConceptBreadth() {
  const [report, setReport] = useState<ConceptReport | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [days, setDays] = useState(30),
    [code, setCode] = useState(""),
    [sort, setSort] = useState("width");
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const r = await fetch("/api/boards?kind=concept-breadth", {
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) throw Error("概念宽度读取失败");
        const j = await r.json();
        if (j && typeof j === "object" && "status" in j)
          throw Error("等待概念成分和首份真实统计");
        const parsed = conceptReportSchema.parse(j);
        if (active) {
          setReport(parsed);
          setCode((old) => old || parsed.boards[0]?.code || "");
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "更新失败");
      }
    }
    void read();
    const timer = setInterval(read, 300000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const boards = useMemo(
    () =>
      [...(report?.boards ?? [])]
        .filter((b) => b.name.includes(query) || b.code.includes(query))
        .sort((a, b) =>
          sort === "width"
            ? (b.values[0] ?? -1) - (a.values[0] ?? -1)
            : a.name.localeCompare(b.name, "zh-CN"),
        ),
    [report, query, sort],
  );
  const pages = Math.max(1, Math.ceil(boards.length / 16)),
    visible = boards.slice(
      Math.min(page, pages - 1) * 16,
      (Math.min(page, pages - 1) + 1) * 16,
    ),
    selected = report?.boards.find((b) => b.code === code);
  const option = useMemo<EChartsOption>(
    () => ({
      ...base(
        [...(report?.dates ?? [])].reverse(),
        [selected?.name ?? "概念", "全市场"],
        "宽度 · %",
      ),
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: "#849bb1", formatter: "{value}%" },
        splitLine: { lineStyle: { color: "#183247" } },
      },
      series: [
        {
          name: selected?.name ?? "概念",
          type: "line",
          showSymbol: false,
          connectNulls: false,
          data: [...(selected?.values ?? [])].reverse(),
          lineStyle: { width: 2 },
        },
        {
          name: "全市场",
          type: "line",
          showSymbol: false,
          data: [...(report?.market ?? [])].reverse(),
          lineStyle: { width: 1, type: "dashed" },
        },
      ],
    }),
    [report, selected],
  );
  function csv() {
    if (!report) return;
    download(
      "概念宽度-当前筛选-" + report.asOf,
      report.dates
        .slice(0, days)
        .map((date, i) => ({
          日期: date,
          ...Object.fromEntries(boards.map((b) => [b.name, b.values[i]])),
          全市场: report.market[i],
        })),
    );
  }
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>
            概念宽度热力图 <span className="tag">MA20</span>
          </h2>
          <p>同一股票可以属于多个概念 · 点击概念查看走势与有效样本</p>
        </div>
        <div className="actions">
          <div className="segmented">
            {[30, 60, 250].map((n) => (
              <button
                key={n}
                className={days === n ? "selected" : ""}
                onClick={() => setDays(n)}
              >
                {n} 日
              </button>
            ))}
          </div>
          <button disabled={!report} onClick={csv}>
            导出筛选 CSV
          </button>
        </div>
      </div>
      <div className="concept-tools">
        <input
          aria-label="搜索概念宽度"
          placeholder="搜索概念名称或代码"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="概念宽度排序"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="width">最新宽度从高到低</option>
          <option value="name">概念名称</option>
        </select>
        <span>{boards.length} 个概念 · 每页16个</span>
        <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
          上一页
        </button>
        <span>
          {Math.min(page + 1, pages)} / {pages}
        </span>
        <button
          disabled={page >= pages - 1}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
      {error && (
        <p className="analytics-error board-state">{error}；保留已加载结果。</p>
      )}
      {report ? (
        <div className="heatmap-scroll">
          <table className="heatmap">
            <thead>
              <tr>
                <th>交易日期</th>
                {visible.map((b) => (
                  <th key={b.code}>
                    <button
                      onClick={() => setCode(b.code)}
                      title={`有效 ${b.eligible} / 成分 ${b.total}`}
                    >
                      {b.name}
                    </button>
                  </th>
                ))}
                <th>全市场</th>
              </tr>
            </thead>
            <tbody>
              {report.dates.slice(0, days).map((date, i) => (
                <tr key={date}>
                  <th>{date.slice(2)}</th>
                  {[
                    ...visible.map((b) => ({
                      v: b.values[i],
                      name: b.name,
                      n: b.eligible,
                    })),
                    { v: report.market[i], name: "全市场", n: undefined },
                  ].map((b, j) => (
                    <td
                      key={j}
                      style={{
                        background:
                          b.v == null
                            ? "#132332"
                            : `hsl(${b.v < 50 ? 161 : 10} 45% ${16 + Math.abs(b.v - 50) * 0.45}%)`,
                      }}
                      title={`${b.name} ${date}：${b.v ?? "缺失"}%；有效样本 ${b.n ?? "全部"}`}
                    >
                      {b.v ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="trend-empty">等待真实概念宽度数据</div>
      )}
      {selected && (
        <div className="concept-trend">
          <div className="panel-heading">
            <div>
              <h2>
                {selected.name} <span className="tag">宽度趋势</span>
              </h2>
              <p>
                有效样本 {selected.eligible} / {selected.total} · 成分日期{" "}
                {selected.membershipDate}
                {selected.eligible < 10 ? " · 样本较少，比例变化较大" : ""}
              </p>
            </div>
          </div>
          <Chart option={option} label="概念宽度历史趋势" />
        </div>
      )}
      <div className="panel-foot">
        行情 {report?.asOf ?? "—"} ·
        当前成分回看250日，非逐日历史成分。概念相互重叠，不计算概念合计；缺失不补零。
        <span>概念分类：东方财富 · 行业 Tab：申万一级</span>
      </div>
    </>
  );
}
