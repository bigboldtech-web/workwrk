import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A staff member removed from the staff list while the console is open
// (Phase 9 walk, finding 1). The console's server layout only refuses on a
// full render, so the browser side has to recognise the staff gate's 403 and
// tell the console shell, which replaces the screen with the denial.

vi.mock("./prisma", () => ({ prisma: {} }));

import {
  apiFetch,
  isStaffAccessRemoved,
  isStaffDenial,
  NOT_STAFF_CODE,
  parseErrorBody,
  resetStaffAccessRemoved,
  STAFF_ACCESS_REMOVED_EVENT,
} from "./api-fetch";
import { staffGateRefusal } from "./platform-admin";
import { resetSessionExpired } from "./session-expiry";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("the staff gate's 403", () => {
  it("names itself with the code the browser side looks for", async () => {
    const res = staffGateRefusal();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe(NOT_STAFF_CODE);
    expect(body.error).toMatch(/staff list/);
  });

  it("parseErrorBody keeps the code; a plain 403 has none", () => {
    expect(parseErrorBody(403, "application/json", JSON.stringify({ error: "x", code: NOT_STAFF_CODE })).code).toBe(NOT_STAFF_CODE);
    expect(parseErrorBody(403, "application/json", '{"error":"Forbidden"}').code).toBeUndefined();
  });

  it("isStaffDenial is only the coded 403", () => {
    expect(isStaffDenial({ ok: false, status: 403, code: NOT_STAFF_CODE })).toBe(true);
    expect(isStaffDenial({ ok: false, status: 403 })).toBe(false);
    expect(isStaffDenial({ ok: false, status: 500, code: NOT_STAFF_CODE })).toBe(false);
    expect(isStaffDenial({ ok: true, status: 403, code: NOT_STAFF_CODE })).toBe(false);
  });
});

describe("apiFetch on a staff-gate 403", () => {
  const realFetch = globalThis.fetch;
  const events: string[] = [];
  beforeEach(() => {
    events.length = 0;
    resetStaffAccessRemoved();
    resetSessionExpired();
    vi.stubGlobal("window", {
      location: { href: "http://localhost:3013/admin/companies" },
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
    });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    resetStaffAccessRemoved();
  });

  it("tells the shell once, then stops calling the console's API", async () => {
    const spy = vi.fn(async () => staffGateRefusal());
    globalThis.fetch = spy as unknown as typeof fetch;

    const first = await apiFetch("/api/admin/companies");
    expect(first.ok).toBe(false);
    expect(isStaffDenial(first as { ok: boolean; status: number; code?: string })).toBe(true);
    expect(isStaffAccessRemoved()).toBe(true);
    expect(events).toEqual([STAFF_ACCESS_REMOVED_EVENT]);

    // The pollers stop: the next console call never reaches the network.
    const second = await apiFetch("/api/admin/search?q=a");
    expect(second).toMatchObject({ ok: false, status: 403, code: NOT_STAFF_CODE });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(events).toEqual([STAFF_ACCESS_REMOVED_EVENT]);
  });

  it("never stops a product call", async () => {
    globalThis.fetch = vi.fn(async () => staffGateRefusal()) as unknown as typeof fetch;
    await apiFetch("/api/admin/me");
    const product = vi.fn(async () => json(200, { a: 1 }));
    globalThis.fetch = product as unknown as typeof fetch;
    const r = await apiFetch("/api/administration-notes");
    expect(r.ok).toBe(true);
    expect(product).toHaveBeenCalledTimes(1);
  });

  it("an ordinary 403 is just a failed call: no event, nothing stops", async () => {
    const spy = vi.fn(async () => json(403, { error: "Forbidden" }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await apiFetch("/api/admin/companies");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(isStaffAccessRemoved()).toBe(false);
    expect(events).toEqual([]);
    await apiFetch("/api/admin/companies");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
