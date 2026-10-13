import test from 'node:test';
import assert from 'node:assert/strict';
import {breadthRequest} from '../lib/breadth-request.ts';
test('transient GET failure retries and returns real response',async()=>{
  const previous=global.fetch; let calls=0;
  global.fetch=async()=>{if(++calls===1)throw new TypeError('Failed to fetch');return Response.json({ok:true});};
  try {assert.deepEqual(await (await breadthRequest('/api/breadth')).json(),{ok:true});assert.equal(calls,2);} finally {global.fetch=previous;}
});
test('POST is not retried and missing basis retains server explanation',async()=>{
  const previous=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;throw new TypeError('Failed to fetch');};
  try {
    await assert.rejects(breadthRequest('/api/breadth/refresh',{method:'POST'}),/刷新结果暂未确认/);
    assert.equal(calls,1);
    global.fetch=async()=>Response.json({message:'历史行情基准未就绪'},{status:503});
    assert.equal((await breadthRequest('/api/breadth/refresh')).status,503);
  } finally {global.fetch=previous;}
});
