"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {analyticsSchema,flowState,type Analytics} from '@/lib/analytics';
import type {EChartsOption} from 'echarts';

function Chart({option,label}:{option:EChartsOption;label:string}){
 const optionRef=useRef(option);optionRef.current=option;const el=useRef<HTMLDivElement>(null);const ref=useRef<import('echarts').ECharts|null>(null);
 useEffect(()=>{let disposed=false;let observer:ResizeObserver|undefined;
 import('echarts').then(e=>{if(disposed||!el.current)return;ref.current=e.init(el.current);ref.current.setOption(optionRef.current);observer=new ResizeObserver(()=>ref.current?.resize());observer.observe(el.current);});
 return()=>{disposed=true;observer?.disconnect();ref.current?.dispose();ref.current=null;};},[]);
 useEffect(()=>{if(ref.current)ref.current.setOption(option,{replaceMerge:['series','xAxis','yAxis']});},[option]);
 return <div className="analytics-chart" ref={el} role="img" aria-label={label}/>;
}
const colors=['#16876b','#de775f','#597ec2','#af91c2','#9ca9a3'];
function base(dates:string[],names:string[],unit:string):EChartsOption{return {
 animation:false,color:colors,tooltip:{trigger:'axis',valueFormatter:(v)=>v==null?'缺失':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:3})},
 legend:{data:names,top:8,left:20,type:'scroll',textStyle:{color:'#687c72',fontSize:11}},
 grid:{left:64,right:68,top:66,bottom:84},
 xAxis:{type:'category',data:dates,boundaryGap:false,axisLabel:{color:'#829189'},axisLine:{lineStyle:{color:'#e1e9e3'}}},
 yAxis:{type:'value',name:unit,scale:true,axisLabel:{color:'#829189'},splitLine:{lineStyle:{color:'#edf1ee'}}},
 dataZoom:[{type:'inside',filterMode:'none'},{type:'slider',bottom:18,height:25,start:Math.max(0,(dates.length-250)/dates.length*100),end:100,borderColor:'#dce6df',fillerColor:'rgba(22,135,107,.12)',handleStyle:{color:'#16876b'}}]
};}
const n=(value:number|undefined|null,d=2)=>value==null?'—':value.toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
function download(name:string,rows:object[]){if(!rows.length)return;const fields=Object.keys(rows[0]);const quote=(x:unknown)=>`"${String(x??'').replaceAll('"','""')}"`;const csv='\ufeff'+[fields,...rows.map(r=>fields.map(k=>(r as Record<string,unknown>)[k]))].map(r=>r.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Note({data}:{data:Analytics['margin']|Analytics['flow']|Analytics['turnover']|undefined}){return <div className="analytics-status"><span className={data?.status==='error'?'analytics-error':''}>{data?.error??'数据源：东方财富 · 免费更新可能延迟'}</span><span>数据时间 {data?.asOf??'—'} · 采集 {data?.collectedAt?new Date(data.collectedAt).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—'}</span></div>;}
function Empty(){return <div className="trend-empty">等待真实行情数据接通，暂无可绘制的序列</div>;}
export default function AnalyticsPanels(){
 const [data,setData]=useState<Analytics|null>(null);const [error,setError]=useState('');const [now,setNow]=useState(new Date());const [amounts,setAmounts]=useState(false);
 useEffect(()=>{let active=true;const update=async()=>{try{const r=await fetch('/api/analytics',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(r.status===401?'请登录后查看新增模块':'新增模块暂时无法更新');const json=await r.json();if(json && typeof json==='object' && 'status' in json && json.status==='awaiting-data'){if(active)setError('等待首轮采集');return;}const parsed=analyticsSchema.parse(json);if(active){setData(parsed);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'更新失败');}};void update();const timer=setInterval(()=>void update(),300000);const clock=setInterval(()=>setNow(new Date()),30000);return()=>{active=false;clearInterval(timer);clearInterval(clock);};},[]);
 const turnover=useMemo<EChartsOption>(()=>{const r=data?.turnover.rows??[];const names=amounts?['中证2000成交额','沪深300成交额']:['成交额比值','10日均值','10日均值 > 2'];return {...base(r.map(x=>x.date),names,amounts?'亿元':'倍'),series:amounts?[
 {name:names[0],type:'line',showSymbol:false,data:r.map(x=>x.csiAmount==null?null:x.csiAmount/1e8)},
 {name:names[1],type:'line',showSymbol:false,data:r.map(x=>x.hsAmount==null?null:x.hsAmount/1e8)}]:[
 {name:names[0],type:'line',showSymbol:false,data:r.map(x=>x.ratio),lineStyle:{width:1,opacity:.35}},
 {name:names[1],type:'line',showSymbol:false,data:r.map(x=>x.ma10),lineStyle:{width:2},markLine:{symbol:'none',data:[{yAxis:2}],label:{formatter:'阈值 2'},lineStyle:{color:'#b48c67',type:'dashed'}}},
 {name:names[2],type:'scatter',symbolSize:5,data:r.map(x=>x.alert?x.ma10:null)}]};},[data,amounts]);
 const flow=useMemo<EChartsOption>(()=>{const r=data?.flow.rows??[];const names=['主力净流入','超大单','大单','中单','小单'];const keys=['main','super','large','medium','small'] as const;return {...base(r.map(x=>x.time.slice(11)),names,'亿元'),legend:{data:names,top:8,left:20,type:'scroll',selected:{'中单':false,'小单':false}},dataZoom:[{type:'inside',filterMode:'none'},{type:'slider',bottom:18,height:25,start:0,end:100}],series:keys.map((key,i)=>({name:names[i],type:'line',showSymbol:false,data:r.map(x=>x[key]),lineStyle:{width:i===0?2.5:1.5},...(i===0?{areaStyle:{opacity:.06}}:{})}))};},[data]);
 const margin=useMemo<EChartsOption>(()=>{const r=data?.margin.rows??[];const names=['两融余额','融资余额','融券余额','上证指数'];return {...base(r.map(x=>x.date),names,'亿元'),legend:{data:names,top:8,left:20,type:'scroll',selected:{'融资余额':false,'融券余额':false}},yAxis:[{type:'value',name:'余额 · 亿元',scale:true,splitLine:{lineStyle:{color:'#edf1ee'}}},{type:'value',name:'上证指数 · 点',scale:true,splitLine:{show:false}}],series:[{name:names[0],type:'line',showSymbol:false,data:r.map(x=>x.balance),areaStyle:{opacity:.05}},{name:names[1],type:'line',showSymbol:false,data:r.map(x=>x.financing)},{name:names[2],type:'line',showSymbol:false,data:r.map(x=>x.securities)},{name:names[3],type:'line',yAxisIndex:1,showSymbol:false,data:r.map(x=>x.index),lineStyle:{color:'#de775f',width:2}}]};},[data]);
 const t=data?.turnover.rows.at(-1),f=data?.flow.rows.at(-1),m=data?.margin.rows.at(-1);
 return <div className="analytics-panels">
 {error&&<p className="analytics-error" role="status">{error}；已加载的数据继续保留。</p>}
 <section id="turnover" className="panel"><div className="panel-heading"><div><h2>成交额比值 <span className="tag">中证2000 / 沪深300</span></h2><p>小盘与大盘的交易活跃程度 · 932000 / 399300</p></div><div className="analytics-actions"><button onClick={()=>setAmounts(!amounts)}>{amounts?'查看比值':'查看成交额'}</button><button disabled={!t} onClick={()=>download('中证2000-沪深300-成交额比值',data!.turnover.rows)}>导出 CSV</button></div></div>
 <div className="analytics-metrics"><div><small>最新成交额比值</small><strong>{n(t?.ratio)}<em>倍</em></strong></div><div><small>10 日均值</small><strong>{n(t?.ma10)}<em>倍</em></strong></div><div><small>阈值标记</small><strong className={t?.alert?'analytics-error':''}>{!t||t.ma10==null?'—':t.alert?'高于 2':'未高于 2'}</strong></div></div>
 {t?<Chart option={turnover} label="中证2000与沪深300成交额比值，可拖动时间轴"/>:<Empty/>}<Note data={data?.turnover}/><div className="panel-foot">比值 = 中证2000成交额 ÷ 沪深300成交额；10日均值严格大于2时标记。日线盘后更新，最多3000日，缺失不补零。<span>拖动底部时间轴或在图内缩放</span></div></section>
 <section id="fund-flow" className="panel"><div className="panel-heading"><div><h2>当日资金流向 <span className="tag">沪深全市场</span></h2><p>{data?flowState(data,now):'等待首轮分时采集'}</p></div><button disabled={!f} onClick={()=>download('沪深全市场资金流向-'+(data?.flow.asOf?.slice(0,10)??''),data!.flow.rows)}>导出 CSV</button></div>
 <div className="analytics-metrics"><div><small>主力净流入</small><strong>{n(f?.main)}<em>亿元</em></strong></div><div><small>超大单</small><strong>{n(f?.super)}<em>亿元</em></strong></div><div><small>大单</small><strong>{n(f?.large)}<em>亿元</em></strong></div></div>
 {f?<Chart option={flow} label="沪深全市场当日累计资金净流入，可拖动分钟时间轴"/>:<Empty/>}<Note data={data?.flow}/><div className="panel-foot">当日累计净流入，按数据源订单大小分类；主力 = 超大单 + 大单。负值表示净流出，不代表资金实际流出证券账户。<span>点击图例切换曲线 · 拖动时间轴查看时段</span></div></section>
 <section id="margin" className="panel"><div className="panel-heading"><div><h2>两融与上证指数 <span className="tag">日频</span></h2><p>融资融券余额与市场走势 · 双轴对照</p></div><button disabled={!m} onClick={()=>download('两融余额-上证指数',data!.margin.rows)}>导出 CSV</button></div>
 <div className="analytics-metrics"><div><small>两融余额</small><strong>{n(m?.balance)}<em>亿元</em></strong></div><div><small>融资 / 融券余额</small><strong className="compact-value">{n(m?.financing)} / {n(m?.securities)}</strong></div><div><small>上证指数</small><strong>{n(m?.index)}<em>点</em></strong></div></div>
 {m?<Chart option={margin} label="两融余额及上证指数走势，可拖动日期时间轴"/>:<Empty/>}<Note data={data?.margin}/><div className="panel-foot">采用东方财富两融账户统计汇总：两融余额 = 融资余额 + 融券余额。按披露日期更新，非盘中实时，最多500日。<span>左轴余额 · 右轴指数 · 默认最近250日</span></div></section>
 </div>;
}

