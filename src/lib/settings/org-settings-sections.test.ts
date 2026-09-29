import { describe, expect, it } from "vitest";
import {
  cultureSectionSchema,
  describeIssue,
  generalSectionSchema,
  parseSettingsEnvelope,
  scoringSectionSchema,
  securitySectionSchema,
} from "./org-settings-sections";
import { LOCKABLE_PREFERENCE_PATHS, isPreferenceLocked, partitionLockedKeys } from "../preferences-locks";
import { normalizeAccent } from "../accents";

describe("parseSettingsEnvelope", () => {
  it("accepts { section, data } and Identity's legacy top-level companyProfile as culture", () => {
    expect(parseSettingsEnvelope({ section: "general", data: { name: "Acme" } })).toEqual({ kind: "section", section: "general", data: { name: "Acme" } });
    expect(parseSettingsEnvelope({ companyProfile: { mission: "m" } })).toEqual({ kind: "section", section: "culture", data: { mission: "m" } });
  });
  it("refuses a second key riding along under a laxer section (the People team mission bypass)", () => {
    const r = parseSettingsEnvelope({ section: "process", companyProfile: { mission: "hijack" } });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.error).toContain("companyProfile");
  });
  it("answers retired sections with retired:true and writes nothing", () => {
    for (const section of ["notifications", "modules"]) {
      const r = parseSettingsEnvelope({ section, data: {} });
      expect(r).toMatchObject({ kind: "error", status: 400, retired: true });
    }
  });
  it("names an unknown section and refuses a non-object body", () => {
    expect(parseSettingsEnvelope({ section: "nope", data: {} })).toMatchObject({ kind: "error", error: "Unknown section: nope" });
    expect(parseSettingsEnvelope(null).kind).toBe("error");
    expect(parseSettingsEnvelope([1]).kind).toBe("error");
  });
});

describe("section schemas are strict and name the key", () => {
  it("general refuses an unknown key and an empty name", () => {
    const bad = generalSectionSchema.safeParse({ name: "Acme", inbox: true });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(describeIssue(bad.error, "general")).toBe("Unknown general setting: inbox");
    const empty = generalSectionSchema.safeParse({ name: "   " });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(describeIssue(empty.error, "general")).toContain("general.name");
  });
  it("general accepts both fiscal-year shapes the readers understand", () => {
    expect(generalSectionSchema.safeParse({ fiscalYearStart: 4 }).success).toBe(true);
    expect(generalSectionSchema.safeParse({ fiscalYearStart: "04-01" }).success).toBe(true);
    expect(generalSectionSchema.safeParse({ fiscalYearStart: 13 }).success).toBe(false);
    expect(generalSectionSchema.safeParse({ currency: "usd" }).success).toBe(true);
    expect(generalSectionSchema.safeParse({ currency: "dollars" }).success).toBe(false);
  });
  it("culture keeps the splash policy to its three values", () => {
    expect(cultureSectionSchema.safeParse({ mission: "m", values: ["a"], splash: "off" }).success).toBe(true);
    expect(cultureSectionSchema.safeParse({ splash: "always" }).success).toBe(false);
    expect(cultureSectionSchema.safeParse({ logo: "x" }).success).toBe(false);
  });
  it("security can never go below the eight-character floor", () => {
    expect(securitySectionSchema.safeParse({ minPasswordLength: 7 }).success).toBe(false);
    expect(securitySectionSchema.safeParse({ minPasswordLength: 12, requireUppercase: true }).success).toBe(true);
    expect(securitySectionSchema.safeParse({ mfaEverywhere: true }).success).toBe(false);
  });
  it("scoring demands five anchors when anchors are sent", () => {
    expect(scoringSectionSchema.safeParse({ behavioralAnchors: ["a", "b"] }).success).toBe(false);
    expect(scoringSectionSchema.safeParse({ behavioralAnchors: ["a", "b", "c", "d", "e"] }).success).toBe(true);
  });
});

describe("preferences-locks", () => {
  it("has the five lockable dot-paths", () => {
    expect([...LOCKABLE_PREFERENCE_PATHS]).toEqual(["theme.appearance", "theme.accent", "density", "sidebar.iconsOnly", "home.cards"]);
  });
  it("splits a lockedKeys write into accepted paths and named unknowns, deduplicated", () => {
    expect(partitionLockedKeys(["density", "density", "theme.colour", 3])).toEqual({ ok: ["density"], unknown: ["theme.colour", "3"] });
  });
  it("answers whether a row is locked", () => {
    expect(isPreferenceLocked(["density"], "density")).toBe(true);
    expect(isPreferenceLocked(null, "density")).toBe(false);
  });
});

describe("normalizeAccent", () => {
  it("keeps a drawn key and sends anything else to the brand blue", () => {
    expect(normalizeAccent("mint")).toBe("mint");
    expect(normalizeAccent("violet")).toBe("workwrk");
    expect(normalizeAccent(undefined)).toBe("workwrk");
    expect(normalizeAccent(42)).toBe("workwrk");
  });
});
