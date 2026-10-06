// A contract over the SOURCE: every file that sends a request to the model on
// WorkwrK's key goes through the plan's AI allowance (src/lib/ai-allowance.ts)
// or the daily limit of Fill with AI and Talk updates (src/lib/ai-usage.ts).
// Before Batch 13 most AI routes counted nothing and had no rate limit, so a
// free workspace could run the model without end; a new model call that skips
// this is the same hole again.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const MODEL_CALL = /getAnthropicForOrg\(|messages\.(create|stream)\(|createMessageWithFallback\(/;
const METERED = /claimAiAction\(|claimAiQuestion\(|aiAutoAllowed\(|claimAiUse\(/;

// Files that reach the model and are NOT metered, each for a reason.
const EXEMPT: Record<string, string> = {
  "src/lib/ai-client.ts": "the client factory itself; its callers are metered",
  "src/lib/ai-fallback.ts": "the model-availability retry helper; its callers are metered",
  "src/app/api/organization/byok/route.ts": "tests the workspace's OWN key before saving it (BYOK), never WorkwrK's",
  "src/lib/agents/engine.ts": "an AI teammate's turn; every caller claims the turn's question first (claimTeammateTurn), which the contract below holds",
};

const ENGINE = "src/lib/agents/engine.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("every model call is metered", () => {
  const files = [...walk("src/app/api"), ...walk("src/lib")].filter((f) => MODEL_CALL.test(readFileSync(path.join(ROOT, f), "utf8")));

  it("finds the model calls (the scan itself works)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("claims a question, checks the automatic rule, or uses the daily limit", () => {
    const unmetered = files.filter((f) => !EXEMPT[f] && !METERED.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(unmetered).toEqual([]);
  });

  it("keeps the exemptions real: each exempt file still exists and still calls the model", () => {
    for (const f of Object.keys(EXEMPT)) expect(files).toContain(f);
  });
});

// The AI teammate engine claims nothing itself (src/lib/agents/engine.ts): a
// turn's question is claimed by whoever starts the turn, through
// src/lib/agents/budget.ts. So every file that runs a turn claims one.
describe("every AI teammate turn is metered", () => {
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

  it("is started only by code that claims the turn's question first", () => {
    const callers = [...walk("src/app/api"), ...walk("src/lib")].filter((f) => f !== ENGINE && /runTeammateTurn\(/.test(read(f)));
    expect(callers.filter((f) => !/claimTeammateTurn\(/.test(read(f)))).toEqual([]);
  });

  it("keeps the engine where this contract looks for it", () => {
    expect(read(ENGINE)).toMatch(/export async function runTeammateTurn\(/);
  });
});
