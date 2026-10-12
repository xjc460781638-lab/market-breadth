import test from 'node:test';
import assert from 'node:assert/strict';
import {retainFlowHistory} from '../lib/flow-history.ts';
const base={schemaVersion:1,kind:'flow-index',source:'sina',resolution:'minute',revision:'a'.repeat(24),collectedAt:'2026-10-12T07:01:00Z',asOf:'2026-10-12 15:00',calendar:['2026-10-12'],times:['2026-10-12 09:30','2026-10-12 15:00'],boards:[{code:'sina:sh000300',name:'沪深300',provider:'sina',asOf:'2026-10-12 15:00',values:[2,3],net:3,error:null}]};
test('provider change replaces whole curve rather than splicing morning values',()=>{
 const incoming=structuredClone(base);incoming.boards[0].provider='tencent';incoming.boards[0].values=[null,4];
 assert.deepEqual(retainFlowHistory(base,incoming).boards[0].values,[null,4]);
});
test('partial primary report cannot erase more complete backup at same close',()=>{
 const incoming=structuredClone(base);incoming.source='eastmoney';incoming.boards.push({...incoming.boards[0],code:'1.000905',asOf:null,values:[null,null]});
 assert.equal(retainFlowHistory(base,incoming).source,'sina');
});
test('same provider keeps valid morning data when late response is sparse',()=>{
 const incoming=structuredClone(base);incoming.boards[0].values=[null,4];
 assert.deepEqual(retainFlowHistory(base,incoming).boards[0].values,[2,4]);
});
