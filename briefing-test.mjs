import { getPeriod, phtDateString } from "./src/lib/briefings/period.ts";

const cases = [
  { label: "morning cron (06:00 PHT Apr 24)", type: "morning", now: new Date("2026-04-23T22:00:00Z"), expected: { start: "2026-04-23", end: "2026-04-23" } },
  { label: "evening cron (22:00 PHT Apr 24)", type: "evening", now: new Date("2026-04-24T14:00:00Z"), expected: { start: "2026-04-24", end: "2026-04-24" } },
  { label: "morning rerun (19:00 PHT Apr 24)", type: "morning", now: new Date("2026-04-24T11:00:00Z"), expected: { start: "2026-04-23", end: "2026-04-23" } },
  { label: "evening rerun (10:00 PHT Apr 24)", type: "evening", now: new Date("2026-04-24T02:00:00Z"), expected: { start: "2026-04-24", end: "2026-04-24" } },
  { label: "weekly cron (09:00 PHT Mon Apr 27)", type: "weekly", now: new Date("2026-04-27T01:00:00Z"), expected: { start: "2026-04-20", end: "2026-04-26" } },
  { label: "monthly cron (09:00 PHT May 1)", type: "monthly", now: new Date("2026-05-01T01:00:00Z"), expected: { start: "2026-04-01", end: "2026-04-30" } },
  { label: "evening rerun (23:59 PHT Apr 24)", type: "evening", now: new Date("2026-04-24T15:59:00Z"), expected: { start: "2026-04-24", end: "2026-04-24" } },
  { label: "morning rerun (00:01 PHT Apr 24)", type: "morning", now: new Date("2026-04-23T16:01:00Z"), expected: { start: "2026-04-23", end: "2026-04-23" } },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const p = getPeriod(c.type, c.now);
  const startStr = phtDateString(p.start);
  const endStr = phtDateString(p.end);
  const ok = startStr === c.expected.start && endStr === c.expected.end;
  if (ok) { pass++; console.log(`PASS ${c.label}: ${startStr} -> ${endStr}`); }
  else { fail++; console.log(`FAIL ${c.label}: got ${startStr} -> ${endStr}, expected ${c.expected.start} -> ${c.expected.end}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
