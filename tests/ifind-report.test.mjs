import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSchema} from '../lib/breadth.ts';
const industries=Array.from({length:31},(_,i)=>({code:String(100000+i),name:'测试行业'+i}));
const calendar=Array.from({length:50},(_,i)=>new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10));
function fixture(){
 const values=Object.fromEntries([...industries.map(s=>s.code),'market','sum'].map(k=>[k,{value:k==='sum'?1550:50,above:k==='sum'?null:5,total:k==='sum'?31:10}]));
 return {schemaVersion:1,provider:'ifind',revision:'0'.repeat(24),asOf:calendar.at(-1),collectedAt:'2026-10-13T10:00:00Z',sourceAsOf:null,quoteTimeRange:null,kind:'final',window:20,historyDays:30,industries,rows:calendar.slice(-30).reverse().map(date=>({date,values})),eligibleStocks:5000,universeStocks:5200,coverage:96,failedStocks:0,excludedStocks:200,industryAsOf:calendar.at(-1),calendar,source:'同花顺 iFinD',notes:[]};
}
test('30-day reports accepted, length mismatch and old providers rejected',()=>{
 const report=fixture();assert.equal(reportSchema.safeParse(report).success,true);
 assert.equal(reportSchema.safeParse({...report,historyDays:250}).success,false);
 assert.equal(reportSchema.safeParse({...report,provider:'legacy'}).success,false);
 assert.equal(reportSchema.safeParse({...report,rows:report.rows.slice(1)}).success,false);
});
