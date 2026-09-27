import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/settings and GET /api/boot read the same settings.currency, and an
// org that never pressed Save on Locale has none. Both must invent the SAME
// code for it: Settings > Locale used to say INR while Assets (fed by boot)
// priced in USD, and an admin typing rupees into a dialog labelled USD had
// nothing on either screen explaining the disagreement. The database and
// the session are mocked so the handler runs as the pure function it is
// between those two calls.

const findUnique = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { organization: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: vi.fn() }));

import { getServerSession } from "next-auth";
import { GET } from "./route";
import { ORG_CURRENCY_FALLBACK, orgCurrencyFromSettings } from "@/lib/org/org-currency";

function org(settings: unknown) {
  return {
    id: "org1", name: "Acme Corp", slug: "acme", domain: null, logo: null, plan: "FREE", status: "ACTIVE",
    settings,
    _count: { users: 3, sops: 0, aiQueries: 0 },
  };
}

describe("GET /api/settings currency", () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", organizationId: "org1" } } as never);
    findUnique.mockReset();
  });

  it("falls back to the same code as /api/boot when the org never saved one", async () => {
    findUnique.mockResolvedValue(org(null));
    const res = await GET();
    const body = await res.json();
    expect(body.settings.currency).toBe(ORG_CURRENCY_FALLBACK);
    expect(body.settings.currency).toBe(orgCurrencyFromSettings(null));
  });

  it("returns the saved code, normalised the way boot normalises it", async () => {
    findUnique.mockResolvedValue(org({ currency: "inr" }));
    const res = await GET();
    const body = await res.json();
    expect(body.settings.currency).toBe("INR");
    expect(body.settings.currency).toBe(orgCurrencyFromSettings({ currency: "inr" }));
  });
});
