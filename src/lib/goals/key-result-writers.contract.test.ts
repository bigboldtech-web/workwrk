// Every writer of KeyResult.currentValue and KeyResult.progress in src, by
// name (docs/plans/recurring-goals.md B8, M10), the way the Inbox
// completeness test names every notification type.
//
// A repeating goal's target numbers are its PERIODS' numbers, and
// writePeriodValue (goal-periods.server.ts) is their only writer: it mirrors
// the current period onto the KeyResult row for the readers that read the
// row (Home, search, MCP, Ask AI). Any other write of the row's number on a
// repeating goal would put a number on Home that no period holds. So every
// write of currentValue or progress is listed here with why it may stand,
// and a new one fails this test until someone decides where it belongs.
//
// What it reads: each prisma call on keyResult (create, createMany, update,
// updateMany, upsert) and each nested `keyResults: { create }`, with the
// argument it is given (balanced brackets), counted as a writer when that
// argument names currentValue or progress, or spreads an object (whose keys
// it cannot see). Raw SQL that updates or inserts "KeyResult" counts too.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith("-test-db.ts")) out.push(p);
  }
}

/** The text of the bracketed argument starting at `open` (a "(" or "{"), strings skipped. */
function bracketed(src: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

// The number by name, a spread (keys it cannot see), or `data: someObject`.
const NUMBER = /\bcurrentValue\b|\bprogress\b|\.\.\.|\bdata:\s*[A-Za-z_$][\w$]*\s*[,}]/;

/** "file: what" for every write of the number. */
function writers(): string[] {
  const files: string[] = [];
  walk(SRC, files);
  const out: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const call = /\bkeyResult\.(create|createMany|update|updateMany|upsert)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = call.exec(src))) {
      const arg = bracketed(src, m.index + m[0].length - 1);
      if (NUMBER.test(arg)) out.push(`${rel}: keyResult.${m[1]}`);
    }
    const nested = /\bkeyResults\s*:[^,;]{0,80}?\{\s*create\s*:/g;
    while ((m = nested.exec(src))) {
      const arg = bracketed(src, src.indexOf("{", m.index));
      if (NUMBER.test(arg)) out.push(`${rel}: nested keyResults.create`);
    }
    if (/(UPDATE|INSERT INTO)\s+"KeyResult"/.test(src)) out.push(`${rel}: raw SQL`);
  }
  // One entry per kind of write per file, with how many there are.
  const counts = new Map<string, number>();
  for (const w of out) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].map(([w, n]) => `${w} x${n}`).sort();
}

/**
 * Every writer, with the reason it may stand. A repeating goal reaches only
 * the first two; each of the others is reached by a one-time goal alone, or
 * sets a new target's starting number.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "src/lib/goals/goal-periods.server.ts: keyResult.update x1":
    "mirror(), called only by writePeriodValue and the period opening: THE writer of a repeating goal's numbers (B8)",
  "src/lib/goals/goal-periods.server.ts: nested keyResults.create x1":
    "createGoal, the one create path: a new target's starting number (A1), before any period exists",
  "src/app/api/okrs/[id]/check-in/route.ts: keyResult.update x1":
    "a ONE-TIME goal's check-in; a repeating goal returns through checkInRepeating (writePeriodValue) before it",
  "src/app/api/okrs/[id]/key-results/[krId]/route.ts: keyResult.update x2":
    "one: a ONE-TIME goal's KR PATCH (manualData). two: a repeating goal's TEMPLATE edit (title, unit, start, target, KPI, period start, source; its spreads carry periodStart and source only), after its 409 to currentValue; the period's number then moves through applyTargetEditToPeriod and writePeriodValue",
  "src/app/api/okrs/[id]/key-results/route.ts: keyResult.create x1":
    "a new target's starting number; on a repeating goal currentValue is a 409 and the period row is opened by settle",
};

describe("the writers of KeyResult.currentValue and progress (B8)", () => {
  it("are exactly the ones named, each with its reason", () => {
    const found = writers();
    expect(found, `unlisted writers:\n  ${found.filter((w) => !(w in ALLOWED)).join("\n  ")}`).toEqual(Object.keys(ALLOWED).sort());
  });

  it("the one-time writers sit behind the repeating goal's own path", () => {
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
    const checkIn = read("src/app/api/okrs/[id]/check-in/route.ts");
    expect(checkIn.indexOf("if (okrRef.repeat)")).toBeGreaterThan(-1);
    expect(checkIn.indexOf("if (okrRef.repeat)")).toBeLessThan(checkIn.indexOf("prisma.keyResult.update"));
    const patch = read("src/app/api/okrs/[id]/key-results/[krId]/route.ts");
    const branch = patch.indexOf("if (kr.okr.repeat)");
    expect(branch).toBeGreaterThan(-1);
    expect(patch.indexOf("CHECK_IN_INSTEAD", branch)).toBeGreaterThan(branch);
    expect(patch.indexOf("...manualData")).toBeGreaterThan(branch);
    const post = read("src/app/api/okrs/[id]/key-results/route.ts");
    expect(post.indexOf("CHECK_IN_INSTEAD")).toBeLessThan(post.indexOf("prisma.keyResult.create"));
    // mirror() has exactly the callers it says it has.
    const server = read("src/lib/goals/goal-periods.server.ts");
    const callers = server.split("\n").filter((l) => /\bmirror\(tx/.test(l)).length;
    expect(callers).toBeGreaterThanOrEqual(3);
    expect(server).not.toMatch(/prisma\.keyResult\.update/);
  });
});
