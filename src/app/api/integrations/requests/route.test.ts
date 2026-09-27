import { beforeEach, describe, expect, it, vi } from "vitest";

// "Request a connector" free text used to vanish: the POST stored only a slug
// (custom:hub-spot), the catalogue GET iterated the static registry and so
// never listed the request back, and the person could neither see nor
// withdraw what they had just sent. These run the two handlers as the pure
// functions they are between the mocked gate and the mocked database.

const db = {
  upsert: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  findMany: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  userFindMany: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integrationRequest: {
      upsert: (...a: unknown[]) => db.upsert(...a),
      count: (...a: unknown[]) => db.count(...a),
      groupBy: (...a: unknown[]) => db.groupBy(...a),
      findMany: (...a: unknown[]) => db.findMany(...a),
    },
    user: { findMany: (...a: unknown[]) => db.userFindMany(...a) },
    $executeRaw: (...a: unknown[]) => db.executeRaw(...a),
    $queryRaw: (...a: unknown[]) => db.queryRaw(...a),
  },
}));
vi.mock("@/lib/app-gate", () => ({
  requireApp: vi.fn(async () => ({ viewer: { userId: "u1", organizationId: "org1", orgRole: "MEMBER" } })),
  isOwnerOrAdmin: () => false,
}));
vi.mock("@/services/googleCalendar", () => ({ isGoogleEnabled: () => false }));
vi.mock("@/lib/api-helpers", async () => {
  const { NextResponse } = await import("next/server");
  return {
    jsonSuccess: (data: unknown, status = 200) => NextResponse.json(data, { status }),
    jsonError: (error: string, status = 400) => NextResponse.json({ error }, { status }),
    getSessionOrFail: vi.fn(),
    getOrgId: vi.fn(),
    isManager: vi.fn(),
  };
});

import { NextRequest } from "next/server";
import { POST } from "./route";
import { GET as catalogue } from "../route";

function post(body: unknown) {
  return POST(new Request("http://x/api/integrations/requests", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

/** The tagged-template arguments of the last raw call, joined into readable SQL with its values. */
function lastRaw(fn: ReturnType<typeof vi.fn>): { sql: string; values: unknown[] } {
  const [strings, ...values] = fn.mock.calls.at(-1) as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join("?"), values };
}

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  db.upsert.mockResolvedValue({});
  db.count.mockResolvedValue(1);
  db.executeRaw.mockResolvedValue(1);
  db.queryRaw.mockResolvedValue([]);
  db.userFindMany.mockResolvedValue([]);
});

describe("POST /api/integrations/requests, the typed name", () => {
  it("groups free text under its slug and keeps the spelling the person typed", async () => {
    const res = await post({ key: "HubSpot  CRM", note: "for the sales team" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe("custom:hubspot-crm");
    expect(body.name).toBe("HubSpot CRM");
    const raw = lastRaw(db.executeRaw);
    expect(raw.sql).toMatch(/UPDATE "IntegrationRequest" SET "name" = \?/);
    expect(raw.values).toEqual(["HubSpot CRM", "org1", "custom:hubspot-crm", "u1"]);
  });

  it("lands free text that names a catalogue connector on that connector's key, so the count is not split", async () => {
    const res = await post({ key: " slack " });
    expect((await res.json()).key).toBe("slack");
    expect(db.executeRaw).not.toHaveBeenCalled();
  });

  it("refuses free text that names a ready connector the way the card would", async () => {
    const res = await post({ key: "Google Calendar" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ready to set up/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("keeps a stored custom key as it is on a re-request from its own card", async () => {
    const res = await post({ key: "custom:walk-addons-connector" });
    const body = await res.json();
    expect(body.key).toBe("custom:walk-addons-connector");
    expect(body.name).toBe("Walk Addons Connector");
    expect(db.executeRaw).not.toHaveBeenCalled();
  });

  it("still answers when the name column is not there yet", async () => {
    db.executeRaw.mockRejectedValue(new Error('column "name" of relation "IntegrationRequest" does not exist'));
    const res = await post({ key: "Notion" });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("custom:notion");
  });
});

describe("GET /api/integrations, the requester's own free-text row", () => {
  function get(query = "") {
    return catalogue(new NextRequest(`http://x/api/integrations${query}`));
  }

  beforeEach(() => {
    db.groupBy.mockResolvedValue([
      { key: "github", _count: { _all: 2 } },
      { key: "custom:hubspot-crm", _count: { _all: 1 } },
    ]);
    // The viewer's own rows, then the raw name read.
    db.findMany.mockResolvedValue([{ key: "custom:hubspot-crm" }]);
    db.queryRaw.mockResolvedValue([{ key: "custom:hubspot-crm", name: "HubSpot CRM" }]);
  });

  it("lists the custom request on the Requested tab as its own withdrawable card", async () => {
    const body = await (await get("?status=requested")).json();
    const keys = body.connectors.map((c: { key: string }) => c.key);
    expect(keys).toContain("custom:hubspot-crm");
    const row = body.connectors.find((c: { key: string }) => c.key === "custom:hubspot-crm");
    expect(row).toMatchObject({ name: "HubSpot CRM", category: "Other", status: "not_built", requestCount: 1, requestedByMe: true, canSetUp: false });
    // github is requested by others, not by this viewer: still on the tab.
    expect(keys).toContain("github");
  });

  it("answers the row search and hides the row behind Ready and a registry category", async () => {
    expect((await (await get("?q=hubspot")).json()).connectors.map((c: { key: string }) => c.key)).toEqual(["custom:hubspot-crm"]);
    expect((await (await get("?status=ready")).json()).connectors.some((c: { key: string }) => c.key.startsWith("custom:"))).toBe(false);
    expect((await (await get("?category=Development")).json()).connectors.some((c: { key: string }) => c.key.startsWith("custom:"))).toBe(false);
  });

  it("humanizes the slug when no typed name survived", async () => {
    db.queryRaw.mockRejectedValue(new Error("does not exist"));
    const body = await (await get()).json();
    expect(body.connectors.find((c: { key: string }) => c.key === "custom:hubspot-crm").name).toBe("Hubspot Crm");
  });
});
