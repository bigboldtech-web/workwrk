// The workspace menu offers no Retry on a refused switch (docs/plans/workspace-status.md,
// the final review, product L4): a 403 (the seat there ended, or the
// workspace is closed) can only fail again. Other failures keep Retry.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { switchFailAction } from "./workspace-switch-toast";

describe("switchFailAction", () => {
  it("offers no Retry on a 403, and Retry on anything else", () => {
    const retry = () => undefined;
    expect(switchFailAction(403, retry)).toEqual({});
    expect(switchFailAction(500, retry)).toEqual({ action: { label: "Retry", onClick: retry } });
    expect(switchFailAction(0, retry).action?.label).toBe("Retry");
  });

  it("is what the workspace menu's failed switch toasts with", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/layout/os/workspace-menu.tsx"), "utf8");
    // Before: { action: { label: "Retry", ... } } on every failure, a 403 included.
    expect(src).toContain('toast(`Couldn\'t switch workspace. ${r.error || "Try again"}`, switchFailAction(r.status, () => { void retryRef.current(orgId, orgName); }));');
    expect(src).not.toMatch(/Couldn't switch workspace[^\n]*label: "Retry"/);
  });
});
