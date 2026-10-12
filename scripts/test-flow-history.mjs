import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/flow-history.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {mergeCurves,retainFlowHistory,removeLegacySnapshots}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const now=new Date('2026-10-12T11:30:00+08:00');
const old={asOf:'2026-10-12 11:25',resolution:'minute',times:['2026-10-12 11:25'],boards:[{code:'90.BK0475',values:[5],net:5,asOf:'2026-10-12 11:25',error:null},{code:'0.399300',values:[8],net:8}]};
const curves=[{code:'90.BK0475',data:{market:90,code:'BK0475',klines:['2026-10-12 09:31,100000000','2026-10-12 09:35,200000000','2026-10-12 11:30,600000000','2026-10-12 13:00,999999999','2026-10-09 09:31,999999999']}}];
const {report}=mergeCurves(old,curves,now);
assert.deepEqual(report.times,['2026-10-12 09:31','2026-10-12 09:35','2026-10-12 11:25','2026-10-12 11:30']);
assert.deepEqual(report.boards[0].values,[1,2,5,6]);assert.equal(report.boards[0].net,6);assert.deepEqual(report.boards[1].values,[null,null,8,null]);
assert.deepEqual(mergeCurves(report,curves,now).report.times,report.times);
assert.throws(()=>mergeCurves(old,[{...curves[0],code:'0.399300'}],now));
assert.deepEqual(retainFlowHistory(report,old).boards[0].values,[1,2,5,6]);
assert.equal(retainFlowHistory(report,{...old,asOf:'2026-10-13 11:25'}).times.length,1);
console.log('PASS: backfills earlier observations, currency units, partial failure preservation, duplicate refresh, future/old-day/identity rejection, scheduled retention');

assert.deepEqual(retainFlowHistory(report,{...old,asOf:'2026-10-09 15:00'}).times,report.times);
console.log('PASS: older trading day cannot replace current-day cached curves');

const legacy={...old,kind:'flow-industry',times:['2026-10-12 10:27'],boards:[{code:'90.BK0475',values:[5],net:5,asOf:'2026-10-12 10:27',error:null}]};
const cleaned=removeLegacySnapshots(legacy);assert.deepEqual(cleaned.boards[0].values,[null]);assert.equal(cleaned.boards[0].net,null);assert.equal(legacy.boards[0].net,5);
const genuine={...legacy,times:['2026-10-12 10:26','2026-10-12 10:27'],boards:[{...legacy.boards[0],values:[4,5]}]};
assert.deepEqual(removeLegacySnapshots(genuine).boards[0].values,[4,5]);
assert.deepEqual(removeLegacySnapshots({...legacy,resolution:'close'}).boards[0].values,[5]);
assert.deepEqual(removeLegacySnapshots({...legacy,times:['2026-10-13 10:27']}).boards[0].values,[5]);
const index={...legacy,kind:'flow-index',times:['2026-10-12 10:28']};assert.equal(removeLegacySnapshots(index).boards[0].net,null);
const repaired=mergeCurves(legacy,curves,now).report;assert.equal(repaired.boards[0].values[repaired.times.indexOf('2026-10-12 10:27')],null);
console.log('PASS: only identified single snapshots removed; genuine curves, daily and other dates retained; old snapshots cannot reappear during merge');
