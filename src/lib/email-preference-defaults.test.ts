import { describe, it, expect, vi } from "vitest";

// email.ts imports the Prisma client; the defaults under test never query.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { EMAIL_PREFERENCE_DEFAULTS } from "@/lib/email";

// The four category switches on /account/notifications and the sender's
// CATEGORY_TO_PREF map (kra, review, sop, kudos). A person with no row must
// see every one of them On, because shouldSendEmail sends them all.
const CATEGORY_FIELDS = ["kraNotifications", "reviewNotifications", "sopNotifications", "kudosNotifications"] as const;

describe("EMAIL_PREFERENCE_DEFAULTS (a person with no EmailPreference row)", () => {
  it("reads every sent category as On, including KRA and KPI updates", () => {
    for (const field of CATEGORY_FIELDS) {
      expect((EMAIL_PREFERENCE_DEFAULTS as Record<string, unknown>)[field], field).toBe(true);
    }
  });

  it("keeps the daily digest Off, matching the schema default", () => {
    expect(EMAIL_PREFERENCE_DEFAULTS.dailyDigest).toBe(false);
  });

  it("carries only real EmailPreference fields", () => {
    expect(Object.keys(EMAIL_PREFERENCE_DEFAULTS).sort()).toEqual([...CATEGORY_FIELDS, "dailyDigest"].sort());
  });
});
