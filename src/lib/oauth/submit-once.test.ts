// The consent form sends once (review of step 1): a double click on Allow
// posted twice, the browser dropped the first answer (the code) for the
// second (a refusal), and the code was stranded.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { submitOnceGuard } from "./submit-once";

describe("submitOnceGuard", () => {
  it("lets the first submit through, stops every one after it, and disables the buttons a moment later", () => {
    const later: Array<() => void> = [];
    let disabled = 0;
    const guard = submitOnceGuard(() => (disabled += 1), (fn) => later.push(fn));
    const prevented: boolean[] = [];
    const event = () => {
      let p = false;
      return { e: { preventDefault: () => (p = true) }, was: () => p };
    };
    const first = event();
    guard.onSubmit(first.e);
    prevented.push(first.was());
    // Not yet: a button disabled during its own submit event would drop the pressed button's value.
    expect(disabled).toBe(0);
    const second = event();
    guard.onSubmit(second.e);
    prevented.push(second.was());
    expect(prevented).toEqual([false, true]);
    expect(guard.sent).toBe(true);
    later.forEach((fn) => fn());
    expect(disabled).toBe(1);
  });

  it("is the consent form's own form", () => {
    const card = readFileSync(path.join(process.cwd(), "src/app/(auth)/oauth/oauth-card.tsx"), "utf8");
    expect(card).toContain('<SubmitOnceForm action="/oauth/decision" className="wa-form">');
    expect(card).not.toContain('<form method="post" action="/oauth/decision"');
    const form = readFileSync(path.join(process.cwd(), "src/app/(auth)/oauth/submit-once-form.tsx"), "utf8");
    expect(form.startsWith('"use client";')).toBe(true);
    expect(form).toContain("once.onSubmit(e);");
    expect(form).toContain("onSubmit={onSubmit}");
  });
});
