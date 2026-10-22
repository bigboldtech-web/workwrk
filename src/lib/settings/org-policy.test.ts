import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRANT_LIFETIME_DAYS,
  grantLifetimeDaysOf,
  DEFAULT_SIGN_IN_POLICY,
  SIGN_IN_BOUNDS,
  dataSettingsOf,
  fiscalMonthOf,
  localeSettingsOf,
  minutesInWords,
  normalizeDomain,
  retentionOf,
  scoreWeightsOf,
  securityWrite,
  signInPolicyOf,
  usersSettingsOf,
  weightsTotal,
  workSettingsOf,
} from "./org-policy";

describe("signInPolicyOf", () => {
  it("answers today's constants when nothing is stored", () => {
    expect(signInPolicyOf(null)).toEqual(DEFAULT_SIGN_IN_POLICY);
    expect(signInPolicyOf({ security: "junk" })).toEqual(DEFAULT_SIGN_IN_POLICY);
  });
  it("keeps valid stored values and defaults the rest", () => {
    const p = signInPolicyOf({ security: { minPasswordLength: 12, requireSymbol: true, lockoutThreshold: 5, mfaRequired: "admins" } });
    expect(p.minPasswordLength).toBe(12);
    expect(p.requireSymbol).toBe(true);
    expect(p.lockoutThreshold).toBe(5);
    expect(p.mfaRequired).toBe("admins");
    expect(p.requireUppercase).toBe(true);
    expect(p.sessionIdleMinutes).toBe(43_200);
  });
  it("never lets a stored value weaken the floor", () => {
    const p = signInPolicyOf({ security: { minPasswordLength: 4, lockoutThreshold: 1000, sessionIdleMinutes: 99999 } });
    expect(p.minPasswordLength).toBe(8);
    expect(p.lockoutThreshold).toBe(8);
    expect(p.sessionIdleMinutes).toBe(43_200);
  });
  it("migrates the old boolean on read", () => {
    expect(signInPolicyOf({ security: { mfaRequired: true } }).mfaRequired).toBe("everyone");
    // The never-enforced twoFactorEnabled is not honoured.
    expect(signInPolicyOf({ security: { twoFactorEnabled: true } }).mfaRequired).toBe("off");
  });
});

describe("the session windows (2026-10-22: no more signing out overnight)", () => {
  it("defaults to 30 days idle and 90 days absolute, bounded 30 minutes to 30 days", () => {
    const p = signInPolicyOf(null);
    expect(p.sessionIdleMinutes).toBe(43_200);
    expect(p.sessionMaxDays).toBe(90);
    expect(SIGN_IN_BOUNDS.sessionIdleMinutes).toEqual({ min: 30, max: 43_200 });
    expect(SIGN_IN_BOUNDS.sessionMaxDays).toEqual({ min: 1, max: 365 });
  });
  it("reads a stored 720, the old default and the old maximum, as unset", () => {
    expect(signInPolicyOf({ security: { sessionIdleMinutes: 720 } }).sessionIdleMinutes).toBe(43_200);
  });
  it("honours every other stored value as the Admin's choice, and a 720 saved since", () => {
    expect(signInPolicyOf({ security: { sessionIdleMinutes: 30 } }).sessionIdleMinutes).toBe(30);
    expect(signInPolicyOf({ security: { sessionIdleMinutes: 719 } }).sessionIdleMinutes).toBe(719);
    expect(signInPolicyOf({ security: { sessionIdleMinutes: 1440 } }).sessionIdleMinutes).toBe(1440);
    expect(signInPolicyOf({ security: { sessionIdleMinutes: 720, sessionIdleChosen: true } }).sessionIdleMinutes).toBe(720);
    expect(signInPolicyOf({ security: { sessionMaxDays: 30 } }).sessionMaxDays).toBe(30);
    expect(signInPolicyOf({ security: { sessionMaxDays: 7 } }).sessionMaxDays).toBe(7);
  });
  it("marks a saved idle window as chosen, and only then", () => {
    expect(securityWrite({ sessionMaxDays: 7 }, { sessionIdleMinutes: 720 })).toEqual({ sessionMaxDays: 7, sessionIdleMinutes: 720, sessionIdleChosen: true });
    expect(securityWrite({ sessionIdleMinutes: 720 }, { lockoutMinutes: 30 })).toEqual({ sessionIdleMinutes: 720, lockoutMinutes: 30 });
    // A save of other fields leaves a stored 720 reading as unset.
    expect(signInPolicyOf({ security: securityWrite({ sessionIdleMinutes: 720 }, { lockoutMinutes: 30 }) }).sessionIdleMinutes).toBe(43_200);
    expect(signInPolicyOf({ security: securityWrite({}, { sessionIdleMinutes: 720 }) }).sessionIdleMinutes).toBe(720);
  });
  it("keeps an AI app connection at 30 days unless the workspace stored a session lifetime (review L4)", () => {
    expect(DEFAULT_GRANT_LIFETIME_DAYS).toBe(30);
    expect(grantLifetimeDaysOf(null)).toBe(30);
    expect(grantLifetimeDaysOf({ security: {} })).toBe(30);
    expect(signInPolicyOf({ security: {} }).sessionMaxDays).toBe(90);
    expect(grantLifetimeDaysOf({ security: { sessionMaxDays: 90 } })).toBe(90);
    expect(grantLifetimeDaysOf({ security: { sessionMaxDays: 7 } })).toBe(7);
    // Not a value the editor can store: as if nothing were stored.
    expect(grantLifetimeDaysOf({ security: { sessionMaxDays: 0 } })).toBe(30);
    expect(grantLifetimeDaysOf({ security: { sessionMaxDays: 400 } })).toBe(30);
    expect(grantLifetimeDaysOf({ security: { sessionMaxDays: "60" } })).toBe(30);
  });
  it("says a number of minutes in plain words", () => {
    expect(minutesInWords(43_200)).toBe("30 days");
    expect(minutesInWords(720)).toBe("12 hours");
    expect(minutesInWords(30)).toBe("30 minutes");
    expect(minutesInWords(1440)).toBe("1 day");
    expect(minutesInWords(1800)).toBe("1 day and 6 hours");
    expect(minutesInWords(1501)).toBe("1 day, 1 hour and 1 minute");
  });
});

describe("retention and data", () => {
  it("keeps trash 60 days and the audit log forever until someone chooses", () => {
    expect(retentionOf({})).toEqual({ trashDays: 60, auditDays: null });
    expect(retentionOf({ retention: { trashDays: 30, auditDays: 10 } })).toEqual({ trashDays: 30, auditDays: null });
    expect(retentionOf({ retention: { auditDays: 400 } }).auditDays).toBe(400);
  });
  it("turns self export and AI off only on an explicit false", () => {
    expect(dataSettingsOf({})).toEqual({ selfExport: true, aiEnabled: true, aiFields: false, aiTalkUpdates: false });
    expect(dataSettingsOf({ data: { selfExport: false, aiEnabled: "no" } })).toEqual({ selfExport: false, aiEnabled: true, aiFields: false, aiTalkUpdates: false });
  });
  it("turns the two AI opt-ins on only on an explicit true, and keeps them as stored", () => {
    expect(dataSettingsOf({ data: { aiFields: "true", aiTalkUpdates: 1 } })).toMatchObject({ aiFields: false, aiTalkUpdates: false });
    expect(dataSettingsOf({ data: { aiFields: true, aiTalkUpdates: true } })).toMatchObject({ aiFields: true, aiTalkUpdates: true });
    // The page shows the stored choice; whether it runs also needs aiEnabled.
    expect(dataSettingsOf({ data: { aiEnabled: false, aiFields: true } })).toMatchObject({ aiEnabled: false, aiFields: true });
  });
});

describe("usersSettingsOf", () => {
  it("seeds the allowed domains from the org domain", () => {
    expect(usersSettingsOf({}, "Acme.com").allowedDomains).toEqual(["acme.com"]);
    expect(usersSettingsOf({}, null).allowedDomains).toEqual([]);
  });
  it("keeps a stored list, even an empty one, and drops junk", () => {
    expect(usersSettingsOf({ users: { allowedDomains: ["@b.io", "not a domain"] } }, "acme.com").allowedDomains).toEqual(["b.io"]);
    expect(usersSettingsOf({ users: { allowedDomains: [] } }, "acme.com").allowedDomains).toEqual([]);
  });
  it("never defaults an invite to Owner", () => {
    expect(usersSettingsOf({ users: { inviteDefaultRole: "OWNER" } }, null).inviteDefaultRole).toBe("MEMBER");
    expect(usersSettingsOf({ users: { inviteDefaultRole: "GUEST" } }, null).inviteDefaultRole).toBe("GUEST");
  });
  it("normalizes a domain", () => {
    expect(normalizeDomain(" @Example.COM. ")).toBe("example.com");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain(12)).toBeNull();
  });
});

describe("locale", () => {
  it("reads the fiscal month from either stored shape", () => {
    expect(fiscalMonthOf(4)).toBe(4);
    expect(fiscalMonthOf("04-01")).toBe(4);
    expect(fiscalMonthOf("11")).toBe(11);
    expect(fiscalMonthOf("13-01")).toBe(4);
    expect(fiscalMonthOf(null)).toBe(4);
  });
  it("defaults the week and formats", () => {
    const l = localeSettingsOf({ timezone: "Europe/Paris", currency: "eur" });
    expect(l).toMatchObject({ timezone: "Europe/Paris", currency: "EUR", weekStart: "MON", dateFormat: "DMY", timeFormat: "24h", language: "en" });
  });
});

describe("workSettingsOf", () => {
  it("reads the pause", () => {
    expect(workSettingsOf({})).toEqual({ automationsPaused: false });
    expect(workSettingsOf({ work: { automationsPaused: true } })).toEqual({ automationsPaused: true });
  });
});

describe("scoreWeightsOf", () => {
  it("answers the four defaults when nothing is stored", () => {
    const w = scoreWeightsOf({});
    expect(w).toEqual({ kpi: 40, sopCompliance: 20, behavioral: 30, peer: 10 });
    expect(weightsTotal(w)).toBe(100);
  });
  it("migrates the old five-key default so the total is 100", () => {
    const w = scoreWeightsOf({ scoreWeights: { kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20 } });
    expect(w).toEqual({ kpi: 40, sopCompliance: 20, behavioral: 30, peer: 10 });
    expect(weightsTotal(w)).toBe(100);
  });
  it("shows the review engine's behavioural default for a custom five-key blob", () => {
    const w = scoreWeightsOf({ scoreWeights: { kpi: 50, manager: 20, peer: 10, self: 0, sopCompliance: 20 } });
    expect(w.behavioral).toBe(30);
  });
  it("keeps a saved four-key shape exactly", () => {
    const w = scoreWeightsOf({ scoreWeights: { kpi: 50, sopCompliance: 10, behavioral: 25, peer: 15 } });
    expect(w).toEqual({ kpi: 50, sopCompliance: 10, behavioral: 25, peer: 15 });
  });
});

import { inviteDomainsOf } from "./org-policy";

describe("inviteDomainsOf", () => {
  it("always keeps the workspace's own domain and adds the rules' domains", () => {
    expect(inviteDomainsOf({ users: { allowedDomains: ["gmail.com"] } }, "acme.com")).toEqual(["acme.com", "gmail.com"]);
    expect(inviteDomainsOf({ users: { allowedDomains: [] } }, "acme.com")).toEqual(["acme.com"]);
    expect(inviteDomainsOf({}, null, "ana@beta.io")).toEqual(["beta.io"]);
    expect(inviteDomainsOf({}, null, null)).toEqual([]);
  });
});
