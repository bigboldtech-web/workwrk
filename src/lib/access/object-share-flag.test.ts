import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Batch 7: the one share dialog serves SOP folders, tools, goals and teams
// only while ACCESS_V2_TABLES is on. With it off (production) every access
// route answers 404 for those kinds and never reaches their writers, so no
// share can be written or read through the new door. The object writers and
// the node resolver are mocked; the flag is the real reader.

const objectAccessPanel = vi.fn();
const setObjectGrant = vi.fn();
const removeObjectGrant = vi.fn();
const checkObjectAccess = vi.fn();
const octx = { userId: "u1", organizationId: "o1", accessLevel: "COMPANY_ADMIN", orgAdmin: true, isAgent: false, session: { user: { id: "u1", organizationId: "o1", accessLevel: "COMPANY_ADMIN" } } };

vi.mock("@/lib/access/object-share", async () => {
  const flags = await import("@/lib/access/flags");
  return {
    objectShareOn: () => flags.accessV2Tables(),
    objectShareCtxFromSession: vi.fn(async () => octx),
    objectAccessPanel: (...a: unknown[]) => objectAccessPanel(...a),
    setObjectGrant: (...a: unknown[]) => setObjectGrant(...a),
    removeObjectGrant: (...a: unknown[]) => removeObjectGrant(...a),
    checkObjectAccess: (...a: unknown[]) => checkObjectAccess(...a),
  };
});
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromSession: vi.fn(async () => ({ userId: "u1", organizationId: "o1", orgAdmin: true, orgGuest: false, isAgent: false, denied: false })),
  accessPanel: vi.fn(async () => null),
  nodeRoles: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/access/grants", () => ({
  GrantError: class GrantError extends Error {
    code: string; status: number; panel?: unknown;
    constructor(code: string) { super(code); this.code = code; this.status = 400; }
  },
  setNodeGrant: vi.fn(),
  removeNodeGrant: vi.fn(),
}));
vi.mock("@/lib/access/check-access", () => ({ checkNodeAccess: vi.fn(async () => "not_found") }));

import { GET as PANEL } from "@/app/api/access/[kind]/[id]/route";
import { DELETE as REMOVE, POST as GRANT } from "@/app/api/access/[kind]/[id]/grants/route";
import { POST as CHECK } from "@/app/api/access/check/route";

const KINDS = ["sop_folder", "tool", "goal", "team"] as const;
const params = (kind: string) => ({ params: Promise.resolve({ kind, id: "x1" }) });
const post = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("the object kinds with ACCESS_V2_TABLES off", () => {
  beforeEach(() => {
    vi.stubEnv("ACCESS_V2_TABLES", "");
    for (const f of [objectAccessPanel, setObjectGrant, removeObjectGrant, checkObjectAccess]) f.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const kind of KINDS) {
    it(`answers 404 for ${kind} on every method and never reaches its writer`, async () => {
      const panel = await PANEL(new Request(`http://localhost/api/access/${kind}/x1`), params(kind));
      const grant = await GRANT(post(`http://localhost/api/access/${kind}/x1/grants`, { userId: "u2", role: "VIEW", expected: null }), params(kind));
      const remove = await REMOVE(new Request(`http://localhost/api/access/${kind}/x1/grants?userId=u2&expected=VIEW`, { method: "DELETE" }), params(kind));
      const check = await CHECK(post("http://localhost/api/access/check", { userId: "u2", target: { kind, id: "x1" } }));
      expect([panel.status, grant.status, remove.status, check.status]).toEqual([404, 404, 404, 404]);
      expect(objectAccessPanel).not.toHaveBeenCalled();
      expect(setObjectGrant).not.toHaveBeenCalled();
      expect(removeObjectGrant).not.toHaveBeenCalled();
      expect(checkObjectAccess).not.toHaveBeenCalled();
    });
  }
});

describe("the object kinds with ACCESS_V2_TABLES on", () => {
  beforeEach(() => {
    vi.stubEnv("ACCESS_V2_TABLES", "true");
    objectAccessPanel.mockReset().mockResolvedValue({ node: { kind: "tool" } });
    setObjectGrant.mockReset().mockResolvedValue({ panel: null, change: { userId: "u2", role: "VIEW", previousRole: null, noChange: false, stillReaches: null, keepsInside: [] } });
    removeObjectGrant.mockReset().mockResolvedValue({ panel: null, change: { userId: "u2", role: null, previousRole: "VIEW", noChange: false, stillReaches: null, keepsInside: [] } });
    checkObjectAccess.mockReset().mockResolvedValue({ userId: "u2", name: "Lea", role: "VIEW", sentence: "Can view. Shared with them directly." });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serves each kind through its own writer", async () => {
    for (const kind of KINDS) {
      expect((await PANEL(new Request(`http://localhost/api/access/${kind}/x1`), params(kind))).status).toBe(200);
      expect((await GRANT(post(`http://localhost/api/access/${kind}/x1/grants`, { userId: "u2", role: "VIEW", expected: null }), params(kind))).status).toBe(200);
      expect((await REMOVE(new Request(`http://localhost/api/access/${kind}/x1/grants?userId=u2&expected=VIEW`, { method: "DELETE" }), params(kind))).status).toBe(200);
      expect((await CHECK(post("http://localhost/api/access/check", { userId: "u2", target: { kind, id: "x1" } }))).status).toBe(200);
    }
    expect(objectAccessPanel).toHaveBeenCalledTimes(4);
    expect(setObjectGrant.mock.calls.map((c) => c[1])).toEqual([...KINDS]);
    expect(removeObjectGrant.mock.calls.map((c) => [c[1], c[3]])).toEqual(KINDS.map((k) => [k, { userId: "u2", expected: "VIEW" }]));
    expect(checkObjectAccess).toHaveBeenCalledTimes(4);
  });

  it("still refuses a kind that is neither a node nor one of the four", async () => {
    expect((await PANEL(new Request("http://localhost/api/access/contract/x1"), params("contract"))).status).toBe(400);
    expect(objectAccessPanel).not.toHaveBeenCalled();
  });
});
