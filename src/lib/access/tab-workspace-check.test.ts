// A tab still showing the workspace the person switched away from (final
// Settings review, H1): it names that workspace in x-workspace-id, and the
// shared admin write gates refuse it with 409 workspace_changed and the
// x-stale-tab header, before reading anything, so the save never lands on
// the workspace the session acts in now. A request naming no workspace (an
// API key, a script, the cron) is not checked, and neither is one made
// outside a request, where headers() throws.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ header: null as string | null, throws: false, reads: 0 }));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (st.throws) throw new Error("`headers` was called outside a request scope.");
    return new Headers(st.header === null ? {} : { "x-workspace-id": st.header });
  },
  cookies: async () => ({ getAll: () => [], get: () => undefined }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { st.reads += 1; return null; } }) }),
}));
vi.mock("@/lib/admin/company-detail", () => ({ ownerIdsFor: async () => [] }));

import { staleTabRefusal, tabWorkspaceMismatch, WORKSPACE_CHANGED_ERROR, workspaceChangedResponse } from "./tab-workspace-check";
import { freshActorRefusal, freshWorkspaceActor } from "./workspace-admin";
import { settingsWriteGate } from "./settings-write";

const admin = { user: { id: "u1", organizationId: "org-b", accessLevel: "COMPANY_ADMIN", tokenVersion: 1 } };

beforeEach(() => {
  st.header = null;
  st.throws = false;
  st.reads = 0;
});

describe("tabWorkspaceMismatch", () => {
  it("no header: no check (an API key, the MCP server, a script, a page outside the dashboard)", async () => {
    expect(await tabWorkspaceMismatch("org-b")).toBe(false);
  });

  it("the tab names the session's own workspace: fine", async () => {
    st.header = "org-b";
    expect(await tabWorkspaceMismatch("org-b")).toBe(false);
  });

  it("the tab names another workspace: a mismatch", async () => {
    st.header = "org-a";
    expect(await tabWorkspaceMismatch("org-b")).toBe(true);
  });

  it("an empty header names nothing", async () => {
    st.header = "";
    expect(await tabWorkspaceMismatch("org-b")).toBe(false);
    st.header = "  ";
    expect(await tabWorkspaceMismatch("org-b")).toBe(false);
  });

  it("outside a request (a test, the cron) headers() throws: read as no header", async () => {
    st.throws = true;
    expect(await tabWorkspaceMismatch("org-b")).toBe(false);
  });
});

describe("the refusal", () => {
  it("is 409 workspace_changed, in words, with the header that raises the tab's strip", async () => {
    const res = workspaceChangedResponse();
    expect(res.status).toBe(409);
    expect(res.headers.get("x-stale-tab")).toBe("1");
    expect(await res.json()).toEqual({ error: WORKSPACE_CHANGED_ERROR, code: "workspace_changed" });
    expect(WORKSPACE_CHANGED_ERROR).toBe("This tab shows another workspace. Reload it to make changes here.");
  });

  it("staleTabRefusal answers it on a mismatch and nothing otherwise (the people routes)", async () => {
    expect(await staleTabRefusal("org-b")).toBeNull();
    st.header = "org-a";
    expect((await staleTabRefusal("org-b"))?.status).toBe(409);
  });
});

describe("the shared admin write gates", () => {
  it("freshWorkspaceActor refuses a tab showing another workspace before reading anything", async () => {
    st.header = "org-a";
    expect(await freshWorkspaceActor(admin)).toEqual({ ok: false, status: 409, error: WORKSPACE_CHANGED_ERROR, code: "workspace_changed" });
    expect(st.reads).toBe(0);
  });

  it("a request naming the session's own workspace goes on to the database read", async () => {
    st.header = "org-b";
    // The mocked account is not found, so the read refuses as stale: the point is that it was read.
    expect(await freshWorkspaceActor(admin)).toMatchObject({ ok: false, status: 403, code: "stale_session" });
    expect(st.reads).toBeGreaterThan(0);
  });

  it("settingsWriteGate answers the refusal every caller passes through: 409, the code, the strip's header", async () => {
    st.header = "org-a";
    const gate = await settingsWriteGate(admin, "identity");
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(409);
    expect(gate.response.headers.get("x-stale-tab")).toBe("1");
    expect(await gate.response.json()).toEqual({ error: WORKSPACE_CHANGED_ERROR, code: "workspace_changed" });
  });

  it("freshActorRefusal marks only workspace_changed for the strip, and keeps a caller's own headers", async () => {
    const stale = freshActorRefusal({ ok: false, status: 403, error: "Your access changed a moment ago.", code: "stale_session" }, { "Cache-Control": "no-store" });
    expect(stale.status).toBe(403);
    expect(stale.headers.get("x-stale-tab")).toBeNull();
    expect(stale.headers.get("cache-control")).toBe("no-store");
    const moved = freshActorRefusal({ ok: false, status: 409, error: WORKSPACE_CHANGED_ERROR, code: "workspace_changed" }, { "Cache-Control": "no-store" });
    expect(moved.headers.get("x-stale-tab")).toBe("1");
    expect(moved.headers.get("cache-control")).toBe("no-store");
  });
});
