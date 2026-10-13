"use client";
import {manualRefresh} from "@/lib/manual-refresh";
import { useEffect, useMemo, useRef, useState } from "react";
import { flowReportSchema, type FlowReport } from "@/lib/boards";
import { Chart, base, n } from "./market-chart";

import { flowGrid } from "@/lib/flow-grid";
import { defaultFlowSelection } from "@/lib/flow-selection";
import { flowColors } from "@/lib/flow-colors";
import type { EChartsOption } from "echarts";
const tabs = [
  ["concept", "概念板块"],
  ["industry", "行业板块"],
  ["index", "指数板块"],
] as const;
export default function BoardFlows() {
  const selectionMode = useRef<"top" | "all" | "custom">("top");
  const imageExport=useRef<((filename:string)=>void)|null>(null);
  const [tab, setTab] = useState("concept"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState("in"),
    [reports, setReports] = useState<Record<string, FlowReport>>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [now, setNow] = useState(new Date());
  const [date, setDate] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [readVersion, setReadVersion] = useState(0);
  const retryCursor=useRef<Record<string,number>>({});
  const refreshController=useRef<AbortController|null>(null);
  useEffect(()=>()=>refreshController.current?.abort(),[]);
  async function refresh() {
    setRefreshing(true);
    try {
      await manualRefresh(`/api/boards/refresh?kind=flow-${tab}${date?'&date='+date:''}${selected.length?'&codes='+encodeURIComponent(selected.join(',')):''}`,setRefreshMessage);
      setReadVersion(v=>v+1);
    } catch(e) {setRefreshMessage(e instanceof Error?e.message:'刷新失败');}
    finally {setRefreshing(false);}
  }

  const reportKey = `${tab}:${date}`;
  const report = reports[reportKey];
  useEffect(() => {
    let active = true;
    async function read() {
      setLoading(true);
      try {
        const r = await fetch("/api/boards?kind=flow-" + tab + (date ? "&date=" + date : ""), {
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) throw Error("板块数据读取失败");
        if (active) setDates((r.headers.get("X-Flow-Dates") || "").split(",").filter(Boolean));
        const j = await r.json();
        if (j && typeof j === "object" && "status" in j)
          throw Error(date ? "该交易日暂无留存的分时资金记录" : "旧数据已清除，等待同花顺 iFinD 板块数据");
        let parsed = flowReportSchema.parse(j);
        if (parsed.resolution === "close") {
          const historyDates = (r.headers.get("X-Flow-Dates") || "").split(",").filter(d => d && d <= parsed.asOf.slice(0,10)).sort();
          const snapshots = await Promise.all(historyDates.map(async day => {
            if (day === parsed.asOf.slice(0,10)) return parsed;
            try {
              const response = await fetch(`/api/boards?kind=flow-${tab}&date=${day}`, {cache:"no-store",signal:AbortSignal.timeout(25000)});
              if (!response.ok) return null;
              const result = flowReportSchema.safeParse(await response.json());
              return result.success && result.data.resolution === "close" ? result.data : null;
            } catch { return null; }
          }));
          const byDay = snapshots.map(snapshot => new Map(snapshot?.boards.map(board => [board.code,board.net]) ?? []));
          parsed = {...parsed,times:historyDates.map(day => day+" 15:00"),boards:parsed.boards.map(board => ({...board,values:byDay.map(values => values.get(board.code) ?? null)}))};
        }
        if (active) {
          setReports((old) => ({ ...old, [reportKey]: parsed }));
          setSelected(old => selectionMode.current === "all" ? parsed.boards.map(b => b.code) : selectionMode.current === "top" ? defaultFlowSelection(parsed.boards) : old);
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
  }, [tab, date, reportKey, readVersion]);
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
  const chartReport = useMemo(() => report ? flowGrid(report,now) : undefined,[report,now]);
  const colors=useMemo(()=>flowColors((report?.boards??[]).map(b=>b.code)),[report]);
  const boardColor=(code:string)=>colors.get(code)??'#a3b8cc';
  const firstAfternoon=report?.resolution!=='close'&&report?.times.some(t=>t.endsWith('13:01'));
  const elapsedNodes=chartReport?.resolution!=="close" ? (chartReport?.times??[]).map((time,i)=>({time,i})).filter(({time})=>{
    const minute=Number(time.slice(11,13))*60+Number(time.slice(14,16));
    return ((minute>=570&&minute<=690)||(minute>=780&&minute<=900))&&Date.parse(time.replace(" ","T")+":00+08:00")<=now.getTime();
  }) : [];
  const completeBoards=chartReport?.boards.filter(b=>elapsedNodes.length&&elapsedNodes.every(({i})=>b.values[i]!==null)).length??0;
  const chosen = (chartReport?.boards ?? []).filter((b) =>
    selected.includes(b.code) && b.values.some(v => v !== null),
  );
  const option = useMemo<EChartsOption>(
    () => ({
      ...base(
        chartReport?.times.map((t) => chartReport.resolution === "close" ? t.slice(0,10) : t.slice(11)) ?? [],
        chosen.map((b) => b.name),
        "净流入 · 亿元",
      ),
      tooltip: {
        trigger: "axis", backgroundColor: "#0c2033", borderColor: "#2a526a",
        textStyle: {color: "#d5eafa"}, confine: true, renderMode: "html",
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params];
          const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]!));
          const index = items[0]?.dataIndex ?? 0;
          const displayTime = chartReport?.times[index] ?? "";
          return escape(displayTime) + items.map(item => {
            const board = chosen.find(b => b.code === item.seriesId);
            const actual = board?.sampleTimes?.[item.dataIndex];
            const note = actual && actual !== displayTime ? `（实际采样 ${actual.slice(11)}）` : "";
            return `<br/>${typeof item.marker === "string" ? item.marker : ""}${escape(item.seriesName ?? "")}: ${item.value == null ? "缺失" : n(Number(item.value)) + " 亿元"}${note}`;
          }).join("");
        },
      },
      animation: true,
      animationDuration: 1400,
      animationEasing: "linear",
      animationDurationUpdate: 500,
      animationEasingUpdate: "cubicOut",
      legend: {
        type: "scroll", top: 8, left: 20, right: 20,
        data: chosen.map(b => b.name),
        selected: Object.fromEntries(chosen.map(b => [b.name,true])),
        selectedMode: false,
        textStyle: {color:"#88a9bf",fontSize:11},
      },
      yAxis: { type: "value", name: "净流入 · 亿元", scale: report?.resolution !== "close", axisLabel: {color:"#7798b1"}, splitLine: {lineStyle:{color:"#193247"}} },
      dataZoom: [
        { type: "inside", start: 0, end: 100, filterMode: "none" },
        { type: "slider", show: true, start: 0, end: 100, bottom: 18, height: 25 },
      ],
      series: chosen.map((b) => ({
        id: b.code,
        name: b.name,
        type: "line",
        itemStyle: {color:boardColor(b.code)},
        showSymbol: b.values.filter((v) => v !== null).length < 2,
        connectNulls: false,
        legendHoverLink: false,
        emphasis: {disabled: true},
        data: b.values,
        lineStyle: { width: 2, color: boardColor(b.code) },
      })),
    }),
    [chartReport, selected, tab],
  );
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const oldDay = report?.asOf.slice(0, 10) !== day;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes() + 480;
  const inSession =
    report?.calendar.includes(day) &&
    ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900));
  const stale =
    !date && inSession &&
    report &&
    (now.getTime() - Date.parse(report.collectedAt) > 600000 ||
      now.getTime() - Date.parse(report.asOf.replace(" ", "T") + ":00+08:00") >
        600000);
  function toggle(code: string) {
    selectionMode.current = "custom";
    setSelected(old => old.includes(code) ? old.filter(c => c !== code) : [...old, code]);
  }
  function downloadImage() {
    if(!report || !imageExport.current) {setRefreshMessage("图表正在初始化，请稍后下载");return;}
    imageExport.current(`${tabs.find(t=>t[0]===tab)?.[1]}-资金流向-${report.asOf}`);
  }
  return (
    <section id="fund-flow" className="panel board-flow">
      <div className="panel-heading">
        <div>
          <h2>
            板块资金流向 <span className="tag">{report?.resolution === "close" ? "近30交易日日终净流入趋势" : "当日累计净流入"}</span>
          </h2>
          <p>观察资金关注的方向，默认选择净流入前 5、净流出前 5，可自由调整或全选。</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={refresh} disabled={refreshing || loading} aria-busy={refreshing}>
          {refreshing ? "正在获取行情…" : "获取最新数据"}
        </button>
        
        <button onClick={downloadImage} disabled={!chosen.length}>
          下载图片
        </button>
        </div>
      </div>
      <div className="board-tabs" role="tablist" aria-label="资金流板块分类">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            disabled={refreshing}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "selected" : ""}
            onClick={() => {
              if (tab === value) return;
              selectionMode.current = "top";
              setTab(value);
              setSelected([]);
              setQuery("");
              setError("");
              setRefreshMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="board-search" style={{padding: "12px 24px"}}>
        <label htmlFor="flow-date">交易日</label>
        <select id="flow-date" disabled={refreshing} value={date} onChange={e => {selectionMode.current = "top";setDate(e.target.value);setSelected([]);setError("");}}>
          <option value="">最新交易日</option>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <small>近 30 个交易日 · 无历史记录的日期将明确提示</small>
      </div>
      <div className="board-state">
        {loading
          ? "正在更新…"
          : report
            ? `${report.asOf} · 有效 ${report.boards.filter(b => b.net !== null).length} / ${report.boards.length} 个板块`
            : "等待数据"}
        {stale && <b className="analytics-error"> 数据已过期</b>}
        {error && <b className="analytics-error"> {error}</b>}
      </div>
      {chartReport?.resolution !== "close" && report && <p className="board-selection-count">已发生的 {elapsedNodes.length} 个采样节点：完整 {completeBoards}/{report.boards.length} 个板块；未加载的曲线可选择后点击刷新；源站未提供的时刻保留空缺。</p>}
      {firstAfternoon && <p className="board-selection-count">13:00 缺失时使用源站 13:01 首条数据展示（实际采样 13:01）；已有的 13:00 原值优先保留。</p>}
      {refreshMessage && <p className="board-selection-count" role="status">{refreshMessage}</p>}
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
          <div className="board-search" aria-label="批量选择板块">
            <button disabled={!report} onClick={() => {selectionMode.current = "top";setSelected(defaultFlowSelection(report?.boards ?? []));}}>流入/流出前5</button>
            <button disabled={!report} onClick={() => {selectionMode.current = "all";setSelected(report?.boards.map(b => b.code) ?? []);}}>全选</button>
            <button disabled={!selected.length} onClick={() => {selectionMode.current = "custom";setSelected([]);}}>清空</button>
          </div>
          <div className="board-ranking" role="group" aria-label="选择对比板块">
            {boards.map((b) => (
              <button
                key={b.code}
                className={
                  "board-row " + (selected.includes(b.code) ? "chosen" : "")
                }
                style={{borderLeftColor: selected.includes(b.code) && b.values.some(v => v !== null) ? boardColor(b.code) : "transparent"}}
                aria-pressed={selected.includes(b.code)}
                onClick={() => toggle(b.code)}
              >
                <span>
                  {b.name}
                  <small>
                    {b.error ? "数据异常 · " + (b.asOf ?? "未就绪") : `同花顺 · ${b.code}`}
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
            已选 {selected.length} / {report?.boards.length ?? 0} · 有效数据 {chosen.length} · 点击再次取消
          </div>
        </div>
        <div className="board-comparison">
          {report?.resolution !== "close" && <p className="board-selection-count">09:30—11:30 / 13:00—15:00 · 午休折叠 · 每5分钟一个节点；11:30 缺失时采用 11:29，13:00 缺失时采用 13:01，悬停显示实际采样时间；其余时刻严格对应，未来与其他缺失点留空。</p>}
          <p className="board-selection-count" aria-live="polite">图中显示 {chosen.length} 条曲线，与已选板块对应；{selected.length - chosen.length} 个已选板块暂无有效数据。颜色与列表左侧标记一致。</p>
          {report ? (
            <Chart
              key={`${tab}:${report.resolution}:${report.asOf.slice(0,10)}`}
              option={option}
              imageExport={imageExport}
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
        同花顺 iFinD 为唯一数据源。概念与指数成分可能重叠，不能加总，也不表示资金从某一板块直接转入另一板块。
        <span>iFinD 主动大单和超大单净额累计 · 手动增量更新</span>
      </div>
    </section>
  );
}

