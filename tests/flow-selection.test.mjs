import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultFlowSelection} from '../lib/flow-selection.ts';
const board = (net,code=String(net),values=[net]) => ({code,net,values});
test('selects five largest inflows and five largest outflows, excluding missing curves',()=>{
  const boards=[...Array.from({length:15},(_,i)=>board(i-7)),board(null),board(999,'missing',[null])];
  assert.deepEqual(defaultFlowSelection(boards),['7','6','5','4','3','-7','-6','-5','-4','-3']);
});
test('does not fill missing sign groups with zero or opposite sign; stable ties',()=>{
  const boards=[board(2,'b'),board(2,'a'),board(-1),board(0)];
  assert.deepEqual(defaultFlowSelection(boards),['a','b','-1']);
  assert.deepEqual(defaultFlowSelection([...boards].reverse()),['a','b','-1']);
  assert.deepEqual(defaultFlowSelection([]),[]);
});
