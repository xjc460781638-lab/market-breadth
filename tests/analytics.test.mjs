import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyticsSchema,flowState} from '../lib/analytics.ts';
const actual=analyticsSchema.parse(JSON.parse(fs.readFileSync(new URL('../data/analytics.json',import.meta.url),'utf8')));
test('real report schema and fund flow arithmetic',()=>{assert.equal(actual.turnover.rows.length,3000);for(const r of actual.flow.rows)assert.ok(Math.abs(r.main-r.large-r.super)<.0001);});
test('flow labels previous day and stale source even after fresh collection',()=>{const d=structuredClone(actual);d.calendar=['2026-10-09'];d.flow.asOf='2026-10-09 10:00';d.flow.collectedAt='2026-10-09T10:30:00+08:00';assert.match(flowState(d,new Date('2026-10-10T10:30:00+08:00')),/非今日/);assert.match(flowState(d,new Date('2026-10-09T10:30:00+08:00')),/过期/);d.flow.asOf='2026-10-09 10:29';assert.match(flowState(d,new Date('2026-10-09T10:30:00+08:00')),/当日分时/);});
