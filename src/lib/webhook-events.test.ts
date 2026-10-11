// WEBHOOK_EVENTS is exactly what is sent. Docs-found fixes batch 2: the
// subscription list and the OpenAPI x-events each kept their own names, and
// neither matched what dispatchEvent is called with. This reads every call in
// src and holds both directions.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { WEBHOOK_EVENT_NAMES, unsentWebhookEvents } from "./webhook-events";

const src = join(__dirname, "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every event name a server module hands to the webhook dispatcher. */
function sentNames(): Set<string> {
  const names = new Set<string>();
  for (const f of files(src)) {
    const text = readFileSync(f, "utf8");
    if (!/dispatchEvent\(\{|emitChained\(/.test(text)) continue;
    // dispatchEvent({ ..., event: "x", ... }) and emitChained(ctx, "x", ...)
    for (const m of text.matchAll(/dispatchEvent\(\{[\s\S]{0,200}?event:\s*"([a-z_.]+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/emitChained\(ctx,\s*"([a-z_.]+)"/g)) names.add(m[1]);
  }
  return names;
}

describe("WEBHOOK_EVENTS", () => {
  it("is exactly the events something sends", () => {
    expect([...sentNames()].sort()).toEqual([...WEBHOOK_EVENT_NAMES].sort());
  });

  it("reports a stored name nothing sends, and never * or a sent one", () => {
    expect(unsentWebhookEvents(["*", "task.created", "sop.published", "task.completed"])).toEqual(["sop.published", "task.completed"]);
  });
});
