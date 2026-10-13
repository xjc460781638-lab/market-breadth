"use client";
import { breadthRequest } from "@/lib/breadth-request";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Clock3,
  Layers3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { downloadHeatmap } from "@/lib/image-export";
import AnalyticsPanels from "@/components/analytics-panels";
import { freshness, reportSchema, type Report } from "@/lib/breadth";

function Trend({ report, code }: { report: Report; code: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let chart: import("echarts").ECharts | undefined;
    let observer: ResizeObserver | undefined;
    import("echarts").then((e) => {
      if (disposed || !el.current) return;
      chart = e.init(el.current);
      const rows = [...report.rows].reverse();
      chart.setOption({
        animation: false,
        tooltip: {
          trigger: "axis",
          backgroundColor: "#0c2033",
          borderColor: "#2a526a",
          textStyle: { color: "#d5eafa" },
          valueFormatter: (v: number) => (v === null ? "缺失" : `${v}%`),
        },
        grid: { left: 38, right: 18, top: 20, bottom: 32 },
        xAxis: {
          type: "category",
          data: rows.map((r) => r.date),
          axisLabel: { color: "#7798b1" },
          axisLine: { lineStyle: { color: "#26465e" } },
          boundaryGap: false,
        },
        yAxis: {
          type: "value",
          min: 0,
          max: 100,
          axisLabel: { formatter: "{value}%", color: "#7798b1" },
          splitLine: { lineStyle: { color: "#193247" } },
        },
        series: [
          {
            name:
              report.industries.find((i) => i.code === code)?.name || "全市场",
            type: "line",
            showSymbol: false,
            connectNulls: false,
            data: rows.map((r) => r.values[code]?.value ?? null),
            lineStyle: { color: "#45d6e8", width: 2 },
            areaStyle: { color: "#0e3546" },
            markLine: {
              symbol: "none",
              silent: true,
              data: [{ yAxis: 50 }],
              label: { show: false },
              lineStyle: { color: "#acb7ae" },
            },
          },
        ],
      });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(el.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [report, code]);
  return (
    <div
      ref={el}
      className="trend-chart"
      role="img"
      aria-label="最近250个交易日市场宽度趋势"
    />
  );
}
const fmt = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${v}${suffix}`;
export default function Home() {
  const [activeSection, setActiveSection] = useState("overview");
  useEffect(() => {
    const syncSection = () => {
      const section = window.location.hash.slice(1);
      setActiveSection(["overview", "heatmap", "trend", "turnover", "fund-flow", "margin"].includes(section) ? section : "overview");
    };
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);
  const navProps = (section: string) => ({
    className: `nav-item${activeSection === section ? " active" : ""}`,
    href: `#${section}`,
    "aria-current": activeSection === section ? "location" as const : undefined,
    onClick: () => setActiveSection(section),
  });
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [days, setDays] = useState(30),
    [code, setCode] = useState("market"),
    [now, setNow] = useState(new Date());
  const busy = useRef(false);
  const [collecting,setCollecting]=useState(false);
  const [collectMessage,setCollectMessage]=useState("");
  async function collectLatest() {
    setCollecting(true);
    try {
      const response=await breadthRequest('/api/breadth/refresh',{method:'POST'});
      const result=await response.json() as {message?:string};
      setCollectMessage(result.message ?? '等待同花顺 iFinD 数据');
    } catch {setError('同花顺采集暂未就绪');}
    finally {setCollecting(false);}
  }
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await breadthRequest("/api/breadth", {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 401) {
        setError("请登录后查看你的市场宽度。");
        return;
      }
      if (!res.ok) throw Error("数据暂时无法读取，已保留最近一次有效结果。");
      const data = await res.json();
      if (
        data &&
        typeof data === "object" &&
        "status" in data &&
        data.status === "awaiting-data"
      ) {
        setError("历史行情正在初始化。完成真实采集后，这里将显示统计结果。");
        return;
      }
      const parsed = reportSchema.safeParse(data);
      if (!parsed.success)
        throw Error("返回数据未通过校验，已保留最近一次有效结果。");
      setReport(parsed.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败，请稍后刷新。");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 300000),
      clock = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, [refresh]);
  const state = report ? freshness(report, now) : "closed",
    latest = report?.rows[0],
    strong = report?.industries.filter(
      (i) => (latest?.values[i.code]?.value ?? 0) > 50,
    ).length;
  function exportImage() {
    if (!report) return;
    const table = document.querySelector<HTMLTableElement>("#heatmap .heatmap");
    if (table) downloadHeatmap(table, `行业宽度热力图-${report.asOf}-${days}日`);
  }
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Activity size={23} />
          </span>
          <div>
            市场宽度<small>MARKET OBSERVATORY</small>
          </div>
        </a>
        <p className="nav-caption">观察工作台</p>
        <a {...navProps("overview")}>
          <BarChart3 size={19} />
          市场总览
          {activeSection === "overview" && <ChevronRight size={15} />}
        </a>
        <a {...navProps("heatmap")}>
          <Layers3 size={19} />
          行业热力图
          {activeSection === "heatmap" && <ChevronRight size={15} />}
        </a>
        <a {...navProps("trend")}>
          <Activity size={19} />
          宽度趋势
          {activeSection === "trend" && <ChevronRight size={15} />}
        </a>
        <a {...navProps("turnover")}>
          <BarChart3 size={19} />
          成交额比值
          {activeSection === "turnover" && <ChevronRight size={15} />}
        </a>
        <a {...navProps("fund-flow")}>
          <Activity size={19} />
          当日资金流向
          {activeSection === "fund-flow" && <ChevronRight size={15} />}
        </a>
        <a {...navProps("margin")}>
          <Layers3 size={19} />
          两融与指数
          {activeSection === "margin" && <ChevronRight size={15} />}
        </a>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <span>
            私有观察空间<small>代码与汇总数据公开</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            沪深 A 股 <span className="slash">/</span> 市场观察
          </span>
          <span className="topbar-right">
            <span className="dot" />
            MA20 · 申万一级行业
          </span>
        </header>
        <main id="overview">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MARKET BREADTH</div>
              <h1>
                看见市场的温度<span>。</span>
              </h1>
              <p>从个股到行业，观察站上 20 日均线的力量。</p>
            </div>
            <button className="refresh" onClick={collectLatest} disabled={loading || collecting} aria-busy={collecting}>
              <RefreshCw size={15} className={loading || collecting ? "spinning" : ""} />
              {collecting ? "采集计算中" : loading ? "读取中" : "刷新数据"}
            </button>
          </div>
          <div className="status-line">
            <span className={`badge ${state}`}>
              {!report
                ? "等待真实数据"
                : state === "stale"
                  ? "数据已过期"
                  : report.kind === "intraday"
                    ? "盘中估算"
                    : "收盘数据"}
            </span>
            <span>
              <Clock3 size={13} />
              行情日期 {report?.asOf ?? "—"}
            </span>
            <span>
              采集{" "}
              {report
                ? new Date(report.collectedAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })
                : "—"}
            </span>
          </div>
          {collectMessage && <div role="status" className="notice breadth-refresh-status">{collectMessage}</div>}
          {error && (
            <div role="status" className="notice">
              {error}
            </div>
          )}
          {state === "stale" && (
            <div role="alert" className="notice warning">
              交易时段连续两个周期未更新，或交易日历已到期。当前显示历史有效结果，请勿当作实时行情。
            </div>
          )}
          <section className="metrics">
            <article>
              <div className="metric-label">
                全市场宽度 <ArrowUpRight size={17} />
              </div>
              <div className="metric-value accent">
                {fmt(latest?.values.market.value)}
                <span>%</span>
              </div>
              <p>收盘价严格高于 MA20 的股票占比</p>
            </article>
            <article>
              <div className="metric-label">
                强势行业 <Layers3 size={17} />
              </div>
              <div className="metric-value">
                {fmt(strong)}
                <span>/ {report?.industries.length ?? "—"}</span>
              </div>
              <p>行业宽度超过 50%</p>
            </article>
            <article>
              <div className="metric-label">
                行业宽度合计 <BarChart3 size={17} />
              </div>
              <div className="metric-value">
                {fmt(latest?.values.sum.value)}
              </div>
              <p>各行业取整后比例之和</p>
            </article>
            <article>
              <div className="metric-label">
                有效样本覆盖 <ShieldCheck size={17} />
              </div>
              <div className="metric-value">
                {fmt(report?.coverage)}
                <span>%</span>
              </div>
              <p>
                {report
                  ? `${report.eligibleStocks.toLocaleString()} / ${report.universeStocks.toLocaleString()} 只股票`
                  : "待完成历史窗口校验"}
              </p>
            </article>
          </section>
          <section id="heatmap" className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>行业宽度热力图</h2>
                    <p>每一格，都是站上 MA20 的股票比例。点击行业查看趋势。</p>
                  </div>
                  <div className="actions">
                    <div className="segmented">
                      {[30, 60, 250].map((n) => (
                        <button
                          key={n}
                          onClick={() => setDays(n)}
                          className={days === n ? "selected" : ""}
                        >
                          {n} 日
                        </button>
                      ))}
                    </div>
                    <button className="export" disabled={!report} onClick={exportImage}>
                      <ArrowDownToLine size={15} />
                      下载图片
                    </button>
                  </div>
                </div>
                <div className="legend">
                  <span>低宽度</span>
                  <i />
                  <span>高宽度</span>
                  <span className="missing-swatch" />
                  缺失
                </div>
                {report ? (
                  <div className="heatmap-scroll">
                    <table className="heatmap">
                      <thead>
                        <tr>
                          <th>交易日期</th>
                          {[
                            ...report.industries,
                            { code: "market", name: "全市场" },
                            { code: "sum", name: "合计" },
                          ].map((i) => (
                            <th key={i.code}>
                              <button
                                onClick={() => {
                                  setCode(i.code === "sum" ? "market" : i.code);
                                  document
                                    .getElementById("trend")
                                    ?.scrollIntoView({ behavior: "smooth" });
                                }}
                              >
                                {i.name.replace("申万", "")}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.slice(0, days).map((r) => (
                          <tr key={r.date}>
                            <th>{r.date.slice(2)}</th>
                            {[
                              ...report.industries.map((i) => i.code),
                              "market",
                              "sum",
                            ].map((c) => {
                              const v = r.values[c]?.value;
                              const hue =
                                v == null
                                  ? "#132332"
                                  : c === "sum"
                                    ? "#10283b"
                                    : `hsl(${v < 50 ? 145 : 0} 65% ${100 - Math.abs(v - 50) * 1.1}%)`;
                              return (
                                <td
                                  key={c}
                                  style={{ background: hue, color: v == null || c === "sum" ? "#d5eafa" : "#10251d" }}
                                  title={`${r.date} ${c}: ${fmt(v)}；有效样本 ${r.values[c]?.total ?? 0}`}
                                >
                                  {fmt(v)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <Layers3 size={36} />
                    <h3>等待同花顺市场宽度数据</h3>
                    <p>
                      旧数据已清除，iFinD 历史初始化尚未完成。
                      <br />
                      采集完成后将自动显示，无需重新部署。
                    </p>
                  </div>
                )}
                <div className="panel-foot">
                  严格大于 MA20 · 银行家取整 · 缺失值不计为零
                  <span>默认最近 30 个交易日</span>
                </div>
          </section>
          <section id="trend" className="panel trend-panel">
            <div className="panel-heading">
              <div>
                <h2>
                  宽度趋势 <span className="tag">250 日</span>
                </h2>
                <p>观察参与上涨的广度，而非价格的高低。</p>
              </div>
              <select
                aria-label="选择趋势行业"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              >
                <option value="market">全市场</option>
                {report?.industries.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            {report ? (
              <Trend report={report} code={code} />
            ) : (
              <div className="trend-empty">真实历史数据就绪后展示趋势</div>
            )}
          </section>
          <AnalyticsPanels />
          <footer className="method">
            <h3>关于数据与口径</h3>
            <p>
              {report?.source ??
                "同花顺 iFinD（唯一数据源）"}
            </p>
            <p>
              沪深 A 股，包含
              ST。按期初上市且整个窗口数据完整筛选；行业采用报告日期的成分回看历史，与聚宽的退市样本、复权和行业覆盖可能不同。盘中使用最新价与前
              19 日收盘价估算，盘后重新计算。
            </p>
            {report?.notes.map((n) => (
              <p key={n}>· {n}</p>
            ))}
            <div className="method-bottom">
              <span>免费调度可能延迟或漏跑 · 不承诺严格实时</span>
              <span>
                行情时间{" "}
                {report?.sourceAsOf ??
                  report?.quoteTimeRange?.join(" — ") ??
                  "数据源未提供可核实时间"}
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
