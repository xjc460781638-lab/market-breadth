"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flowReportSchema, type FlowReport } from "@/lib/boards";
import { Chart, base, n } from "./market-chart";
import { mergeCurves, type CurveInput } from "@/lib/flow-history";
import { flowGrid, flowCandidates } from "@/lib/flow-grid";
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
    if(!report || refreshController.current) return;
    const controller=new AbortController();refreshController.current=controller;
    const started=Date.now();let deadline=started+40000;
    setRefreshing(true);setRefreshMessage("正在读取已保存的最新分时…");
    let done=0,failed=0,saved=0,targets=0,reused=0,saveError="";
    const pending:CurveInput[]=[];
    let saving=Promise.resolve();
    let firstBatch=true;
    const key=`${tab}:`;
    function progress() {setRefreshMessage(`复用 ${reused} 个 · 已检查 ${done}/${targets} · 已保存 ${saved} 个 · 失败 ${failed}（不阻塞已有曲线）`);}
    function enqueue(force=false) {
      if(!pending.length || (!force&&pending.length<(firstBatch?5:25))) return;
      const batch=pending.splice(0,25);firstBatch=false;
      saving=saving.then(async()=>{
        if(saveError) return;
        const response=await fetch(`/api/boards/history?kind=flow-${tab}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({curves:batch}),signal:AbortSignal.timeout(15000)});
        const result=await response.json() as {message?:string;updated:number};
        if(!response.ok) throw Error(result.message||"分时保存失败");
        saved+=result.updated;
        setReports(old=>{
          const current=old[key]??report;
          try {return {...old,[key]:mergeCurves(current,batch).report};} catch{return old;}
        });
        progress();
      }).catch(e=>{saveError=e instanceof Error?e.message:"保存失败";controller.abort();});
    }
    try {
      const response=await fetch(`/api/boards?kind=flow-${tab}`,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
      if(!response.ok) throw Error("最新缓存读取失败，请重试");
      const latest=flowReportSchema.parse(await response.json());
      setReports(old=>({...old,[key]:latest}));setDate("");
      if(selectAll.current) setSelected(latest.boards.map(b=>b.code));
      // Prefer the independently verified full-session backup when primary data is incomplete.
      if(latest.source==='sina'||flowCandidates(latest).length) {
        try {
          setRefreshMessage("正在通过新浪、腾讯备用源补取当日真实分时…");
          const directory=await fetch(`/api/boards/backup?kind=flow-${tab}`,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
          if(!directory.ok)throw Error("备用目录暂不可用");
          const catalog=await directory.json() as {boards:{code:string;name:string}[]};
          let backupSaved=0,backupFailed=0;
          for(let offset=0;offset<catalog.boards.length&&!controller.signal.aborted;offset+=20) {
            try {
              const response=await fetch(`/api/boards/backup?kind=flow-${tab}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({codes:catalog.boards.slice(offset,offset+20).map(b=>b.code)}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
              if(!response.ok)throw Error("备用源请求失败");
              const result=await response.json() as {report:unknown;updated:number;failed:number};
              const incoming=flowReportSchema.parse(result.report);
              setReports(old=>({...old,[key]:incoming}));
              if(selectAll.current)setSelected(incoming.boards.map(b=>b.code));
              backupSaved+=result.updated;backupFailed+=result.failed;
            } catch {backupFailed+=Math.min(20,catalog.boards.length-offset);}
            setRefreshMessage(`备用源：已保存 ${backupSaved} 个板块，缺失 ${backupFailed} 个 · ${Math.min(offset+20,catalog.boards.length)}/${catalog.boards.length}`);
          }
          if(backupSaved) {setRefreshMessage(`备用源已保存 ${backupSaved} 个板块当日分时；${backupFailed} 个暂不可用。未与东方财富曲线拼接；指数来源以列表标注为准。`);return;}
          if(latest.source==='sina')throw Error("新浪暂不可用，保留已保存曲线");
        } catch {if(latest.source==='sina'){setRefreshMessage("备用源请求失败，已保留最近有效曲线");return;}}
        if(controller.signal.aborted)return;
        setRefreshMessage("新浪未返回有效数据，正在重试东方财富…");
      }
      const missing=flowCandidates(latest);
      const offset=(retryCursor.current[tab]??0)%Math.max(1,missing.length);
      const candidates=[...missing.slice(offset),...missing.slice(0,offset)];
      targets=candidates.length;reused=latest.boards.length-targets;
      if(!targets) {setRefreshMessage("已复用云端完整分时，当前5分钟节点无需重复采集");return;}
      deadline=Date.now()+40000;
      let cursor=0;
      await Promise.all(Array.from({length:8},async()=>{
        while(cursor<candidates.length && Date.now()<deadline && !controller.signal.aborted) {
          const board=candidates[cursor++];
          try {
            const params=new URLSearchParams({secid:board.code,klt:"1",lmt:"0",fields1:"f1,f2,f3,f7",fields2:"f51,f52",_:String(Date.now()),ut:"b2884a393a59ad64002292a3e90d46a5"});
            const response=await fetch(`https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?${params}`,{cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now())))])});
            if(!response.ok) throw Error("行情源请求失败");
            const json=await response.json() as {data?:CurveInput['data']};
            const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
            if(!json.data?.klines?.some(line=>typeof line==='string'&&line.startsWith(today))) throw Error("暂无当日分时");
            const last=json.data.klines.filter((line):line is string=>typeof line==='string'&&line.startsWith(today)).map(line=>line.split(',')[0]).sort().at(-1)!;
            const cn=new Date(Date.now()+8*3600000);
            const minute=cn.getUTCHours()*60+cn.getUTCMinutes();
            if(minute>=900 && last<today+' 15:00') failed++;
            pending.push({code:board.code,data:json.data});enqueue();
          } catch {failed++;}
          done++;if(done%10===0) progress();
        }
      }));
      retryCursor.current[tab]=(offset+cursor)%Math.max(1,missing.length);
      enqueue(true);await saving;
      if(saveError) throw Error(saveError);
      const rest=Math.max(0,targets-done);
      setRefreshMessage(`${controller.signal.aborted?"已停止":"本轮完成"} · ${(Date.now()-started)/1000|0}秒 · 复用 ${reused} 个，更新 ${saved} 个；未返回完整最新数据 ${failed} 个${rest?`，待获取 ${rest} 个`:""}。缺失板块可再次刷新重试。`);
    } catch(e) {setRefreshMessage((controller.signal.aborted?"已停止获取":e instanceof Error?e.message:"采集失败")+"；已保存的真实记录继续保留");}
    finally {refreshController.current=null;setRefreshing(false);setNow(new Date());setReadVersion(v=>v+1);}
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
  function downloadImage() {
    if(!report || !imageExport.current) {setRefreshMessage("图表正在初始化，请稍后下载");return;}
    imageExport.current(`${tabs.find(t=>t[0]===tab)?.[1]}-资金流向-${report.asOf}`);
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
        {refreshing && <button onClick={()=>refreshController.current?.abort()}>停止获取</button>}
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
                    {b.error ? "数据异常 · " + (b.asOf ?? "未就绪") : `${b.provider === "tencent" ? "腾讯 · " : b.provider === "sina" ? "新浪 · " : ""}${b.code}`}
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
          {report?.resolution !== "close" && <p className="board-selection-count">09:30—11:30 / 13:00—15:00 · 午休折叠 · 每5分钟一个节点（取该5分钟区间最后有效采样）；未来、缺失时段留空，不插值。</p>}
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
        {report?.source === "sina" ? "备用来源：新浪、腾讯。行业/概念使用新浪分类及净流入额；指数使用来源提供的主力净流入。每个指数标注来源，切换时整条曲线替换，不跨源拼接。" : "当前来源：东方财富，行业采用东方财富分类。"}概念与指数成分可能重叠，不能加总，也不表示资金从某一板块直接转入另一板块。
        <span>来源：东方财富 · 盘中每5分钟尽力更新</span>
      </div>
    </section>
  );
}

