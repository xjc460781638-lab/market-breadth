"use client";
import {manualRefresh} from "@/lib/manual-refresh";
import { useEffect, useMemo, useRef, useState } from "react";
import BoardFlows from "./board-flows";
import { analyticsSchema, flowState, type Analytics } from "@/lib/analytics";
import type { EChartsOption } from "echarts";

import { Chart, base, n } from "./market-chart";
function Note({
  data,
}: {
  data:
    | Analytics["margin"]
    | Analytics["flow"]
    | Analytics["turnover"]
    | undefined;
}) {
  return (
    <div className="analytics-status">
      <span className={data?.status === "error" ? "analytics-error" : ""}>
        {data?.error ?? "唯一数据源：同花顺 iFinD"}
      </span>
      <span>
        数据时间 {data?.asOf ?? "—"} · 采集{" "}
        {data?.collectedAt
          ? new Date(data.collectedAt).toLocaleString("zh-CN", {
              hour12: false,
              timeZone: "Asia/Shanghai",
            })
          : "—"}
      </span>
    </div>
  );
}
function Empty() {
  return (
    <div className="trend-empty">等待同花顺 iFinD 数据，暂无可绘制的序列</div>
  );
}
export default function AnalyticsPanels() {
  const turnoverImage = useRef<((filename: string) => void) | null>(null);
  const marginImage = useRef<((filename: string) => void) | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  const [amounts, setAmounts] = useState(false);
  const [refreshingTurnover,setRefreshingTurnover]=useState(false);
  const [turnoverMessage,setTurnoverMessage]=useState("");
  const [readVersion,setReadVersion]=useState(0);
  async function collectTurnover() {
    setRefreshingTurnover(true);
    try {await manualRefresh('/api/analytics/refresh',setTurnoverMessage);setReadVersion(v=>v+1);}
    catch(e){setTurnoverMessage(e instanceof Error?e.message:'刷新失败');}
    finally{setRefreshingTurnover(false);}
  }

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const r = await fetch("/api/analytics", {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok)
          throw Error(
            r.status === 401 ? "请登录后查看新增模块" : "新增模块暂时无法更新",
          );
        const json = await r.json();
        if (
          json &&
          typeof json === "object" &&
          "status" in json &&
          json.status === "awaiting-data"
        ) {
          if (active) setError("旧数据已清除，等待同花顺 iFinD 数据");
          return;
        }
        const parsed = analyticsSchema.parse(json);
        if (active) {
          setData(parsed);
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "更新失败");
      }
    };
    void update();
    const timer = setInterval(() => void update(), 300000);
    const clock = setInterval(() => setNow(new Date()), 30000);
    return () => {
      active = false;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [readVersion]);
  const turnover = useMemo<EChartsOption>(() => {
    const r = data?.turnover.rows ?? [];
    const names = amounts
      ? ["中证2000成交额", "沪深300成交额"]
      : ["成交额比值", "10日均值", "10日均值 > 2"];
    return {
      ...base(
        r.map((x) => x.date),
        names,
        amounts ? "亿元" : "倍",
      ),
      series: amounts
        ? [
            {
              name: names[0],
              type: "line",
              showSymbol: false,
              data: r.map((x) =>
                x.csiAmount == null ? null : x.csiAmount / 1e8,
              ),
            },
            {
              name: names[1],
              type: "line",
              showSymbol: false,
              data: r.map((x) =>
                x.hsAmount == null ? null : x.hsAmount / 1e8,
              ),
            },
          ]
        : [
            {
              name: names[0],
              type: "line",
              showSymbol: false,
              data: r.map((x) => x.ratio),
              lineStyle: { width: 1, opacity: 0.35 },
            },
            {
              name: names[1],
              type: "line",
              showSymbol: false,
              data: r.map((x) => x.ma10),
              lineStyle: { width: 2 },
              markLine: {
                symbol: "none",
                data: [{ yAxis: 2 }],
                label: { formatter: "阈值 2" },
                lineStyle: { color: "#b48c67", type: "dashed" },
              },
            },
            {
              name: names[2],
              type: "scatter",
              symbolSize: 5,
              data: r.map((x) => (x.alert ? x.ma10 : null)),
            },
          ],
    };
  }, [data, amounts]);
  const flow = useMemo<EChartsOption>(() => {
    const r = data?.flow.rows ?? [];
    const names = ["主力净流入", "超大单", "大单", "中单", "小单"];
    const keys = ["main", "super", "large", "medium", "small"] as const;
    return {
      ...base(
        r.map((x) => x.time.slice(11)),
        names,
        "亿元",
      ),
      legend: {
        data: names,
        top: 8,
        left: 20,
        type: "scroll",
        selected: { 中单: false, 小单: false },
      },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        { type: "slider", bottom: 18, height: 25, start: 0, end: 100 },
      ],
      series: keys.map((key, i) => ({
        name: names[i],
        type: "line",
        showSymbol: false,
        data: r.map((x) => x[key]),
        lineStyle: { width: i === 0 ? 2.5 : 1.5 },
        ...(i === 0 ? { areaStyle: { opacity: 0.06 } } : {}),
      })),
    };
  }, [data]);
  const margin = useMemo<EChartsOption>(() => {
    const r = data?.margin.rows ?? [];
    const names = ["两融余额", "融资余额", "融券余额", "上证指数"];
    return {
      ...base(
        r.map((x) => x.date),
        names,
        "亿元",
      ),
      legend: {
        data: names,
        top: 8,
        left: 20,
        type: "scroll",
        selected: { 融资余额: false, 融券余额: false },
        textStyle: { color: "#9fb5cb" },
      },
      yAxis: [
        {
          type: "value",
          name: "余额 · 亿元",
          scale: true,
          axisLabel: { color: "#8098af" },
          nameTextStyle: { color: "#9fb5cb" },
          splitLine: { lineStyle: { color: "#1b344b" } },
        },
        {
          type: "value",
          name: "上证指数 · 点",
          scale: true,
          axisLabel: { color: "#8098af" },
          nameTextStyle: { color: "#9fb5cb" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: names[0],
          type: "line",
          showSymbol: false,
          data: r.map((x) => x.balance),
          areaStyle: { opacity: 0.05 },
        },
        {
          name: names[1],
          type: "line",
          showSymbol: false,
          data: r.map((x) => x.financing),
        },
        {
          name: names[2],
          type: "line",
          showSymbol: false,
          data: r.map((x) => x.securities),
        },
        {
          name: names[3],
          itemStyle: { color: "#de775f" },
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          data: r.map((x) => x.index),
          lineStyle: { color: "#de775f", width: 2 },
        },
      ],
    };
  }, [data]);
  const t = data?.turnover.rows.at(-1),
    f = data?.flow.rows.at(-1),
    m = data?.margin.rows.at(-1);
  return (
    <div className="analytics-panels">
      {error && (
        <p className="analytics-error" role="status">
          {error}；已加载的数据继续保留。
        </p>
      )}
      <section id="turnover" className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              成交额比值 <span className="tag">中证2000 / 沪深300</span>
            </h2>
            <p>小盘与大盘的交易活跃程度 · 932000 / 399300</p>
          </div>
          <div className="analytics-actions">
            <button onClick={collectTurnover} disabled={refreshingTurnover} aria-busy={refreshingTurnover}>{refreshingTurnover ? "正在获取行情…" : "获取最新数据"}</button>
            <button onClick={() => setAmounts(!amounts)}>
              {amounts ? "查看比值" : "查看成交额"}
            </button>
            <button
              disabled={!t}
              onClick={() =>
                turnoverImage.current?.(`中证2000-沪深300-${amounts ? "成交额" : "成交额比值"}-${data!.turnover.asOf}`)
              }
            >
              下载图片
            </button>
          </div>
        </div>
        <div className="analytics-metrics">
          <div>
            <small>最新成交额比值</small>
            <strong>
              {n(t?.ratio)}
              <em>倍</em>
            </strong>
          </div>
          <div>
            <small>10 日均值</small>
            <strong>
              {n(t?.ma10)}
              <em>倍</em>
            </strong>
          </div>
          <div>
            <small>阈值标记</small>
            <strong className={t?.alert ? "analytics-error" : ""}>
              {!t || t.ma10 == null ? "—" : t.alert ? "高于 2" : "未高于 2"}
            </strong>
          </div>
        </div>
        {t ? (
          <Chart
            imageExport={turnoverImage}
            option={turnover}
            label="中证2000与沪深300成交额比值，可拖动时间轴"
          />
        ) : (
          <Empty />
        )}
        {turnoverMessage && <p className="board-selection-count" role="status">{turnoverMessage}</p>}
        {data?.turnover.kind === "intraday" && <p className="board-selection-count">盘中累计成交额估算 · 10日均值包含当日未收盘数据</p>}
        <Note data={data?.turnover} />
        <div className="panel-foot">
          比值 = 中证2000成交额 ÷
          沪深300成交额；10日均值严格大于2时标记。支持手动获取最新累计成交额，盘后更新日线，最多3000日，缺失不补零。
          <span>拖动底部时间轴或在图内缩放</span>
        </div>
      </section>
      <BoardFlows />
      <section id="margin" className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              两融与上证指数 <span className="tag">日频</span>
            </h2>
            <p>融资融券余额与市场走势 · 双轴对照</p>
          </div>
          <button onClick={collectTurnover} disabled={refreshingTurnover} aria-busy={refreshingTurnover}>{refreshingTurnover?'正在获取行情…':'获取最新数据'}</button>
          <button
            disabled={!m}
            onClick={() => marginImage.current?.(`两融余额-上证指数-${data!.margin.asOf}`)}
          >
            下载图片
          </button>
        </div>
        <div className="analytics-metrics">
          <div>
            <small>两融余额</small>
            <strong>
              {n(m?.balance)}
              <em>亿元</em>
            </strong>
          </div>
          <div>
            <small>融资 / 融券余额</small>
            <strong className="compact-value">
              {n(m?.financing)} / {n(m?.securities)}
            </strong>
          </div>
          <div>
            <small>上证指数</small>
            <strong>
              {n(m?.index)}
              <em>点</em>
            </strong>
          </div>
        </div>
        {m ? (
          <Chart
            imageExport={marginImage}
            option={margin}
            label="两融余额及上证指数走势，可拖动日期时间轴"
          />
        ) : (
          <Empty />
        )}
        <Note data={data?.margin} />
        {turnoverMessage && <p className="board-selection-count" role="status">{turnoverMessage}</p>}
        <div className="panel-foot">
          仅使用同花顺 iFinD 沪深两市统计：两融余额 = 融资余额 +
          融券余额。按披露日期更新，非盘中实时，最多500日。
          <span>左轴余额 · 右轴指数 · 默认最近250日</span>
        </div>
      </section>
    </div>
  );
}
