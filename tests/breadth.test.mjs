import test from "node:test";
import assert from "node:assert/strict";
import { freshness } from "../lib/breadth.ts";
const report = {
  calendar: ["2026-10-09", "2026-10-12"],
  asOf: "2026-10-09",
  kind: "intraday",
  collectedAt: "2026-10-09T10:00:00+08:00",
};
test("two missed cycles become stale", () => {
  assert.equal(
    freshness(report, new Date("2026-10-09T10:09:00+08:00")),
    "live",
  );
  assert.equal(
    freshness(report, new Date("2026-10-09T10:11:00+08:00")),
    "stale",
  );
});
test("holiday and lunch are closed; stale prior-day report is rejected in session", () => {
  assert.equal(
    freshness(report, new Date("2026-10-10T10:11:00+08:00")),
    "closed",
  );
  assert.equal(
    freshness(report, new Date("2026-10-09T12:11:00+08:00")),
    "closed",
  );
  assert.equal(
    freshness(report, new Date("2026-10-12T10:11:00+08:00")),
    "stale",
  );
  assert.equal(
    freshness(report, new Date("2027-10-12T10:11:00+08:00")),
    "stale",
  );
});
