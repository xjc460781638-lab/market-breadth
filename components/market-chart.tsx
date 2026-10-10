"use client";
import {useEffect,useRef,useState} from "react";
import type {EChartsOption} from "echarts";
export function Chart({ option, label }: { option: EChartsOption; label: string }) {
  const dates = (option.xAxis as { data: string[] }).data;
  const initial = (option.dataZoom as { start?: number }[])[0].start ?? 0;
  const [range, setRange] = useState<[number, number]>([initial, 100]);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const optionRef = useRef(option);
  optionRef.current = option;
  const el = useRef<HTMLDivElement>(null);
  const ref = useRef<import("echarts").ECharts | null>(null);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    import("echarts").then((e) => {
      if (disposed || !el.current) return;
      ref.current = e.init(el.current);
      ref.current.setOption(optionRef.current);
      ref.current.on("datazoom", () => {
        const current = ref.current?.getOption().dataZoom as {
          start: number;
          end: number;
        }[];
        if (current?.[0]) setRange([current[0].start, current[0].end]);
      });
      observer = new ResizeObserver(() => ref.current?.resize());
      observer.observe(el.current);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      ref.current?.dispose();
      ref.current = null;
    };
  }, []);
  useEffect(() => {
    if (ref.current)
      ref.current.setOption(option, {
        replaceMerge: ["series", "xAxis", "yAxis"],
      });
    ref.current?.dispatchAction({
      type: "dataZoom",
      start: rangeRef.current[0],
      end: rangeRef.current[1],
    });
  }, [option]);
  const move = (start: number, end: number) => {
    setRange([start, end]);
    ref.current?.dispatchAction({ type: "dataZoom", start, end });
  };
  const dateAt = (percent: number) =>
    dates[Math.round((percent / 100) * (dates.length - 1))];
  return (
    <>
      <div className="analytics-chart" ref={el} role="img" aria-label={label} />
      <div className="chart-range">
        <label>
          起点{" "}
          <input
            aria-label={label + "起点"}
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={range[0]}
            onChange={(e) =>
              move(Math.min(Number(e.target.value), range[1] - 0.1), range[1])
            }
          />
        </label>
        <label>
          终点{" "}
          <input
            aria-label={label + "终点"}
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={range[1]}
            onChange={(e) =>
              move(range[0], Math.max(Number(e.target.value), range[0] + 0.1))
            }
          />
        </label>
        <output aria-live="polite">
          {dateAt(range[0])} — {dateAt(range[1])}
        </output>
        <button onClick={() => move(0, 100)}>全部</button>
      </div>
    </>
  );
}
const colors = ["#45d6e8", "#de775f", "#597ec2", "#af91c2", "#9ca9a3"];
export function base(dates: string[], names: string[], unit: string): EChartsOption {
  return {
    animation: false,
    color: colors,
    tooltip: {
      trigger: "axis",
      backgroundColor:"#0c2033",borderColor:"#2a526a",textStyle:{color:"#d5eafa"},
      valueFormatter: (v) =>
        v == null
          ? "缺失"
          : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 3 }),
    },
    legend: {
      data: names,
      top: 8,
      left: 20,
      type: "scroll",
      textStyle: { color: "#88a9bf", fontSize: 11 },
    },
    grid: { left: 64, right: 68, top: 66, bottom: 84 },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLabel: { color: "#7798b1" },
      axisLine: { lineStyle: { color: "#26465e" } },
    },
    yAxis: {
      type: "value",
      name: unit,
      scale: true,
      axisLabel: { color: "#7798b1" },
      splitLine: { lineStyle: { color: "#193247" } },
    },
    dataZoom: [
      {
        type: "inside",
        filterMode: "none",
        start: Math.max(
          0,
          ((dates.length - 250) / Math.max(1, dates.length)) * 100,
        ),
        end: 100,
      },
      {
        type: "slider",
        bottom: 18,
        height: 25,
        start: Math.max(
          0,
          ((dates.length - 250) / Math.max(1, dates.length)) * 100,
        ),
        end: 100,
        borderColor: "#224059",
        fillerColor: "rgba(69,214,232,.12)",
        handleStyle: { color: "#45d6e8" },
      },
    ],
  };
}
export const n = (value: number | undefined | null, d = 2) =>
  value == null
    ? "—"
    : value.toLocaleString("zh-CN", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
export function download(name: string, rows: object[]) {
  if (!rows.length) return;
  const fields = Object.keys(rows[0]);
  const quote = (x: unknown) => `"${String(x ?? "").replaceAll('"', '""')}"`;
  const csv =
    "\ufeff" +
    [
      fields,
      ...rows.map((r) => fields.map((k) => (r as Record<string, unknown>)[k])),
    ]
      .map((r) => r.map(quote).join(","))
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
