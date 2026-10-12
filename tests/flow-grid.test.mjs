import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {flowGrid} from '../lib/flow-grid.ts';
const day='2026-10-12';
const now=new Date(day+'T16:00:00+08:00');
const fixture={asOf:day+' 15:00',times:['14:55','14:56','14:59','15:00'].map(t=>day+' '+t),boards:[{values:[39.52,39.89,19.43,32.49]}]};
test('14:55 uses 14:55, never 14:56 or 14:59; 15:00 remains separate',()=>{
 const grid=flowGrid(fixture,now);
 assert.equal(grid.boards[0].values[grid.times.indexOf(day+' 14:55')],39.52);
 assert.equal(grid.boards[0].values.at(-1),32.49);
 assert.equal(grid.times.length,50);
 assert.ok(!grid.times.some(t=>t.endsWith('12:00')));
});
test('missing and future exact nodes stay empty even with later samples',()=>{
 const missing=structuredClone(fixture);missing.boards[0].values[0]=null;
 assert.equal(flowGrid(missing,now).boards[0].values[48],null);
 assert.equal(flowGrid(fixture,new Date(day+'T14:54:00+08:00')).boards[0].values[48],null);
});
test('all actual concept, industry and index nodes match their original timestamp',()=>{
 for(const kind of ['concept','industry','index']){
  const raw=JSON.parse(fs.readFileSync(new URL('../data/boards/flow-'+kind+'.json',import.meta.url),'utf8'));
  const grid=flowGrid(raw,now);
  for(let b=0;b<raw.boards.length;b++)for(let i=0;i<grid.times.length;i++){
   const original=raw.times.indexOf(grid.times[i]);
   assert.equal(grid.boards[b].values[i],original<0?null:raw.boards[b].values[original],`${kind}/${raw.boards[b].name}/${grid.times[i]}`);
  }
 }
});
