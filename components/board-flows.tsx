"use client";
import { useEffect, useMemo, useState } from "react";
import { flowReportSchema, type FlowReport } from "@/lib/boards";
import { Chart, base, n, download } from "./market-chart";
import type { EChartsOption } from "echarts";
const tabs = [
  ["concept", "概念板块"],
  ["industry", "行业板块"],
  ["index", "指数板块"],
] as const;
export default function BoardFlows() {
  const [tab, setTab] = useState("concept"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState("in"),
    [reports, setReports] = useState<Record<string, FlowReport>>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [now, setNow] = useState(new Date());
  const report = reports[tab];
  useEffect(() => {
    let active = true;
    async function read() {
      setLoading(true);
      try {
        const r = await fetch("/api/boards?kind=flow-" + tab, {
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) throw Error("板块数据读取失败");
        const j = await r.json();
        if (j && typeof j === "object" && "status" in j)
          throw Error("等待首轮真实板块采集");
        const parsed = flowReportSchema.parse(j);
        if (active) {
          setReports((old) => ({ ...old, [tab]: parsed }));
          setSelected((old) =>
            old.length
              ? old
              : parsed.boards
                  .filter((b) => b.values.some((v) => v !== null))
                  .sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity))
                  .slice(0, 3)
                  .map((b) => b.code),
          );
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void read();
    const interval = setInterval(read, 300000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [tab]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const boards = useMemo(
    () =>
      [...(report?.boards ?? [])]
        .filter((b) => b.name.includes(query) || b.code.includes(query))
        .sort((a, b) =>
          sort === "out"
            ? (a.net ?? Infinity) - (b.net ?? Infinity)
            : (b.net ?? -Infinity) - (a.net ?? -Infinity),
        ),
    [report, query, sort],
  );
  const chosen = (report?.boards ?? []).filter((b) =>
    selected.includes(b.code),
  );
  const option = useMemo<EChartsOption>(
    () => ({
      ...base(
        report?.times.map((t) => t.slice(11)) ?? [],
        chosen.map((b) => b.name),
        "净流入 · 亿元",
      ),
      dataZoom: [
        { type: "inside", start: 0, end: 100, filterMode: "none" },
        { type: "slider", start: 0, end: 100, bottom: 18, height: 25 },
      ],
      series: chosen.map((b) => ({
        name: b.name,
        type: "line",
        showSymbol: b.values.filter((v) => v !== null).length < 2,
        connectNulls: false,
        data: b.values,
        lineStyle: { width: 2 },
      })),
    }),
    [report, selected],
  );
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const oldDay = report?.asOf.slice(0, 10) !== day;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes() + 480;
  const inSession =
    report?.calendar.includes(day) &&
    ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900));
  const stale =
    inSession &&
    report &&
    (now.getTime() - Date.parse(report.collectedAt) > 600000 ||
      now.getTime() - Date.parse(report.asOf.replace(" ", "T") + ":00+08:00") >
        600000);
  function toggle(code: string) {
    setSelected((old) =>
      old.includes(code)
        ? old.filter((c) => c !== code)
        : old.length < 5
          ? [...old, code]
          : old,
    );
  }
  function csv() {
    if (!report) return;
    download(
      "板块资金流-" + tab + "-" + report.asOf.slice(0, 10),
      report.times.map((time, i) => ({
        时间: time,
        ...Object.fromEntries(
          chosen.map((b) => [b.name + "（亿元）", b.values[i]]),
        ),
      })),
    );
  }
  return (
    <section id="fund-flow" className="panel board-flow">
      <div className="panel-heading">
        <div>
          <h2>
            板块资金流向 <span className="tag">当日累计净流入</span>
          </h2>
          <p>观察资金关注的方向，最多选择 5 个板块对比。</p>
        </div>
        <button onClick={csv} disabled={!chosen.length}>
          导出所选曲线
        </button>
      </div>
      <div className="board-tabs" role="tablist" aria-label="资金流板块分类">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "selected" : ""}
            onClick={() => {
              setTab(value);
              setSelected([]);
              setQuery("");
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="board-state">
        {loading
          ? "正在更新…"
          : report
            ? `${oldDay ? "最近交易日" : "当日"} ${report.asOf} · ${report.boards.length} 个板块`
            : "等待数据"}
        {stale && <b className="analytics-error"> 数据已过期</b>}
        {error && <b className="analytics-error"> {error}</b>}
      </div>
      <div className="board-flow-layout">
        <div className="board-picker">
          <div className="board-search">
            <input
              aria-label="搜索资金板块"
              placeholder="搜索板块名称或代码"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="资金排名方向"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="in">净流入优先</option>
              <option value="out">净流出优先</option>
            </select>
          </div>
          <div className="board-ranking" role="group" aria-label="选择对比板块">
            {boards.map((b) => (
              <button
                key={b.code}
                className={
                  "board-row " + (selected.includes(b.code) ? "chosen" : "")
                }
                aria-pressed={selected.includes(b.code)}
                disabled={!selected.includes(b.code) && selected.length >= 5}
                onClick={() => toggle(b.code)}
              >
                <span>
                  {b.name}
                  <small>
                    {b.error ? "数据异常 · " + (b.asOf ?? "未就绪") : b.code}
                  </small>
                </span>
                <b
                  className={
                    b.net === null ? "" : b.net >= 0 ? "money-in" : "money-out"
                  }
                >
                  {n(b.net)}
                  <small>亿元</small>
                </b>
              </button>
            ))}
          </div>
          <div className="board-selection-count">
            已选 {selected.length} / 5 · 点击再次取消
          </div>
        </div>
        <div className="board-comparison">
          {report && chosen.length ? (
            <Chart
              key={tab}
              option={option}
              label={tabs.find((t) => t[0] === tab)?.[1] + "资金流对比"}
            />
          ) : (
            <div className="trend-empty">
              {report ? "从左侧选择板块查看曲线" : "真实板块数据就绪后展示曲线"}
            </div>
          )}
        </div>
      </div>
      <div className="panel-foot">
        行业资金采用东方财富行业分类；概念与指数成分可能重叠，不能加总，也不表示资金从某一板块直接转入另一板块。
        <span>来源：东方财富 · 盘中每5分钟尽力更新</span>
      </div>
    </section>
  );
}
