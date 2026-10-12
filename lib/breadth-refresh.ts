import { z } from "zod";
import { reportSchema, type Report } from "./breadth";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const basisSchema = z.object({
  schemaVersion:z.literal(1),revision:z.string().regex(/^[a-f0-9]{24}$/),day,basisDate:day,
  dates:z.array(day).length(249),template:reportSchema,
  stocks:z.array(z.object({code:z.string().regex(/^(00|30|60|68)\d{4}$/),industry:z.string().nullable(),previousClose:z.number().positive(),sum19:z.number().positive(),boundary:z.number().positive(),boundaryAbove:z.boolean(),history:z.string().regex(/^[01]{249}$/)})).min(1000).max(7000),
}).superRefine((b,c)=>{
  if(b.basisDate>=b.day || b.dates[248]!==b.basisDate || b.dates.some((d,i)=>i>0&&d<=b.dates[i-1]) || new Set(b.stocks.map(s=>s.code)).size!==b.stocks.length)
    c.addIssue({code:"custom",message:"Invalid historical basis"});
});
export type Basis = z.infer<typeof basisSchema>;
export type BreadthQuote = {code:string;price:number;previous:number;time:string};
export function parseBreadthQuote(row:Record<string,unknown>, day:string, now=Date.now()):BreadthQuote|null {
  const {f2:price,f18:previous,f124:stamp,f12:code}=row;
  if(typeof code!=="string" || typeof price!=="number" || !Number.isFinite(price) || price<=0 || typeof previous!=="number" || !Number.isFinite(previous) || previous<=0 || typeof stamp!=="number" || !Number.isFinite(stamp)) return null;
  const age=now-stamp*1000;
  if(Math.abs(price*100-Math.round(price*100))>0.000001) return null;
  const close = Date.parse(day + "T15:00:00+08:00");
  // After close accept only the genuine closing quote, never a stale morning quote.
  if (now >= close ? stamp * 1000 < close || age < -300000 : age > 600000 || age < -300000) return null;
  const time=new Date(stamp*1000+8*3600000).toISOString().slice(0,19).replace("T"," ");
  if(!time.startsWith(day)) return null;
  return {code,price,previous,time};
}
export function roundPercent(above:number,total:number) {
  const numerator=above*100, floor=Math.floor(numerator/total), remainder=numerator%total;
  return remainder*2===total ? floor+(floor%2) : floor+Number(remainder*2>total);
}
export function calculateRefresh(basis:Basis,quotes:BreadthQuote[],now=new Date()):Report {
  const quoteMap=new Map(quotes.map(q=>[q.code,q]));
  const selected=basis.stocks.flatMap(stock=>{
    const quote=quoteMap.get(stock.code);
    return quote && Math.abs(quote.previous-stock.previousClose)<=0.011 ? [{stock,quote}] : [];
  });
  if(selected.length<1000) throw Error(`有效行情仅 ${selected.length} 只，不足1000只，已保留原结果`);
  const codes=[...basis.template.industries.map(i=>i.code),"market"];
  const totals=Object.fromEntries(codes.map(c=>[c,0]));
  const counts=Object.fromEntries(codes.map(c=>[c,new Array<number>(250).fill(0)]));
  for(const {stock,quote} of selected) {
    const keys=stock.industry && stock.industry in totals ? [stock.industry,"market"] : ["market"];
    for(const key of keys) {
      totals[key]++;
      for(let i=0;i<249;i++) counts[key][i]+=Number(stock.history[i]);
      counts[key][249]+=Number(quote.price===stock.boundary ? stock.boundaryAbove : quote.price > (stock.sum19+quote.price)/20);
    }
  }
  const rows=[...basis.dates,basis.day].map((date,i)=>{
    const values:Report["rows"][number]["values"]={};
    for(const code of codes) values[code]={value:totals[code] ? roundPercent(counts[code][i],totals[code]) : null,above:totals[code] ? counts[code][i] : null,total:totals[code]};
    const industries=basis.template.industries.map(s=>values[s.code].value);
    values.sum={value:industries.every(v=>v!==null) ? industries.reduce<number>((a,b)=>a+(b??0),0) : null,above:null,total:industries.length};
    return {date,values};
  }).reverse();
  const times=selected.map(s=>s.quote.time).sort();
  return {...basis.template,rows,asOf:basis.day,kind:now.getTime() >= Date.parse(basis.day+"T15:00:00+08:00") ? "final" : "intraday",sourceAsOf:now.getTime() >= Date.parse(basis.day+"T15:00:00+08:00") ? basis.day+" 15:00:00" : null,collectedAt:now.toISOString(),
    quoteTimeRange:[times[0],times[times.length-1]],eligibleStocks:selected.length,
    excludedStocks:basis.template.universeStocks-selected.length,coverage:Math.round(selected.length/basis.template.universeStocks*10000)/100,
    source:"东方财富实时行情 / 腾讯前复权日线 / 申万行业成分（手动刷新）"};
}
