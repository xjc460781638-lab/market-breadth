"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flowReportSchema, type FlowReport } from "@/lib/boards";
import { Chart, base, n, download } from "./market-chart";
import { flowGrid } from "@/lib/flow-grid";
import type { EChartsOption } from "echarts";
const tabs = [
  ["concept", "概念板块"],
  ["industry", "行业板块"],
  ["index", "指数板块"],
] as const;
const boardColor = (code: string) => {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360}, 72%, 65%)`;
};
export default function BoardFlows() {
  const selectAll = useRef(true);
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
  async function refresh() {
    if(!report || refreshing) return;
    setRefreshing(true);setRefreshMessage("正在补齐开盘以来的真实分时数据…");
    const curves: {code:string;data:{code?:string;market?:number;klines?:string[]}}[]=[];
    let cursor=0,done=0,failed=0;
    try {
      await Promise.all(Array.from({length:8},async()=>{
        while(cursor<report.boards.length) {
          const board=report.boards[cursor++];
          let success=false;
          for(let attempt=0;attempt<3&&!success;attempt++) {
            if(attempt) await new Promise(resolve=>setTimeout(resolve,attempt*1000));
            try {
              const params=new URLSearchParams({secid:board.code,klt:"1",lmt:"0",fields1:"f1,f2,f3,f7",fields2:"f51,f52",ut:"b2884a393a59ad64002292a3e90d46a5"});
              const response=await fetch(`https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?${params}`,{credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(10000)});
              if(!response.ok) continue;
              const json=await response.json() as {data?:{code?:string;market?:number;klines?:string[]}};
              const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
              if(!json.data?.klines?.some(line=>line.startsWith(today))) continue;
              curves.push({code:board.code,data:json.data});success=true;
            } catch { /* Retry failed source requests; do not manufacture samples. */ }
          }
          if(!success) failed++;
          done++;
          setRefreshMessage(`正在获取当日分时 ${done}/${report.boards.length} · 已获取 ${curves.length} 个板块 · 失败 ${failed}`);
        }
      }));
      if(!curves.length) throw Error("分时源暂不可用，未能补齐上午数据");
      let saved=0,asOf="",points=0;
      for(let i=0;i<curves.length;i+=25) {
        const response=await fetch(`/api/boards/history?kind=flow-${tab}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({curves:curves.slice(i,i+25)}),signal:AbortSignal.timeout(25000)});
        const result=await response.json() as {message?:string;updated:number;asOf:string;points:number};
        if(!response.ok) throw Error(result.message||"分时保存失败");
        saved+=result.updated;asOf=result.asOf;points=result.points;
        setRefreshMessage(`正在保存真实分时 ${saved}/${report.boards.length} 个板块`);
      }
      setDate("");setNow(new Date());
      setRefreshMessage(`已补齐 ${saved}/${report.boards.length} 个板块的当日分时 · 至 ${asOf} · ${points} 个分钟时刻${failed ? `；${failed} 个板块接口未返回，保留已有记录，可重试` : ""}`);
    } catch(e) {setRefreshMessage((e instanceof Error?e.message:"分时采集失败")+"；已保存的真实记录继续保留");}
    finally {setRefreshing(false);setReadVersion(v=>v+1);}
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
          throw Error(date ? "该交易日暂无留存的分时资金记录" : "等待首轮真实板块采集");
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
          setSelected(old => selectAll.current ? parsed.boards.map(b => b.code) : old);
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
  const attemptedBackfill=useRef(new Set<string>());
  useEffect(()=>{
    if(!report || loading || refreshing || date) return;
    const cn=new Date(Date.now()+8*3600000),day=cn.toISOString().slice(0,10),minute=cn.getUTCHours()*60+cn.getUTCMinutes();
    if(!report.calendar.includes(day)||minute<571||minute>930) return;
    const expected=Math.min(120,Math.max(0,minute-570))+Math.min(120,Math.max(0,minute-780));
    const key=`${tab}:${day}`;
    const incomplete=report.resolution==="close"||!report.asOf.startsWith(day)||report.boards.some(b=>b.values.filter(v=>v!==null).length<expected-5);
    if(incomplete&&!attemptedBackfill.current.has(key)) {attemptedBackfill.current.add(key);void refresh();}
  },[report,loading,date,tab]);
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
    selectAll.current = false;
    setSelected(old => old.includes(code) ? old.filter(c => c !== code) : [...old, code]);
  }
  function csv() {
    if (!report) return;
    download(
      "板块资金流-" + tab + "-" + report.asOf.slice(0, 10),
      chartReport!.times.map((time, i) => ({
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
            板块资金流向 <span className="tag">{report?.resolution === "close" ? "近10交易日日终净流入趋势" : "当日累计净流入"}</span>
          </h2>
          <p>观察资金关注的方向，默认全选，可自由取消或重新全选。</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={refresh} disabled={refreshing || loading || !report} aria-busy={refreshing}>
          {refreshing ? "正在获取行情…" : "获取最新数据"}
        </button>
        <button onClick={csv} disabled={!chosen.length}>
          导出所选曲线
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
              selectAll.current = true;
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
        <select id="flow-date" disabled={refreshing} value={date} onChange={e => {selectAll.current = true;setDate(e.target.value);setSelected([]);setError("");}}>
          <option value="">最新交易日</option>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <small>近 10 个交易日 · 无历史记录的日期将明确提示</small>
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
      {chartReport?.resolution !== "close" && report && <p className="board-selection-count">已发生的 {elapsedNodes.length} 个5分钟节点：完整 {completeBoards}/{report.boards.length} 个板块；有缺口的板块可点击“获取最新数据”补齐。</p>}
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
            <button disabled={!report} onClick={() => {selectAll.current = true;setSelected(report?.boards.map(b => b.code) ?? []);}}>全选</button>
            <button disabled={!selected.length} onClick={() => {selectAll.current = false;setSelected([]);}}>清空</button>
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
            已选 {selected.length} / {report?.boards.length ?? 0} · 有效数据 {chosen.length} · 点击再次取消
          </div>
        </div>
        <div className="board-comparison">
          {report?.resolution !== "close" && <p className="board-selection-count">09:30—15:00 · 每5分钟一个节点（取该5分钟区间最后有效采样）；未来、午休和缺失时段留空，不插值。</p>}
          <p className="board-selection-count" aria-live="polite">图中显示 {chosen.length} 条曲线，与已选板块对应；{selected.length - chosen.length} 个已选板块暂无有效数据。颜色与列表左侧标记一致。</p>
          {report ? (
            <Chart
              key={`${tab}:${report.resolution}:${report.asOf.slice(0,10)}`}
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
