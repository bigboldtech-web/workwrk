import { describe, expect, it } from "vitest";
import { DEAD_KEYS, LEGACY_KEYS, hasLegacyLocalPrefs, planLocalPrefsMigration } from "./local-prefs-migration";

const now = new Date("2026-09-30T10:00:00Z");

describe("the one-time localStorage move", () => {
  it("does nothing for a clean browser", () => {
    const plan = planLocalPrefsMigration({}, null, { now });
    expect(plan.patch).toBeNull();
    expect(plan.presence).toBeNull();
    expect(plan.removeAfterWrite).toEqual([]);
    expect(plan.removeNow).toEqual([...DEAD_KEYS]);
  });

  it("carries every old key onto an empty row", () => {
    const plan = planLocalPrefsMigration(
      {
        [LEGACY_KEYS.collapsed]: "1",
        [LEGACY_KEYS.width]: "288",
        [LEGACY_KEYS.toolPins]: JSON.stringify(["notepad", "voice"]),
        [LEGACY_KEYS.muted]: "1",
        [LEGACY_KEYS.desktop]: "off",
        [LEGACY_KEYS.density]: "compact",
        [LEGACY_KEYS.savedFilters]: JSON.stringify([{ id: "a", name: "Mine" }, { id: "b" }]),
      },
      null,
      { now },
    );
    expect(plan.patch).toEqual({
      sidebar: { collapsed: true, width: 288, quickTools: ["notepad", "voice"] },
      home: { notifications: { mutedUntil: "2126-09-30T10:00:00.000Z", desktop: false }, work: { savedFilters: [{ id: "a", name: "Mine" }] } },
      density: "compact",
    });
    expect(plan.removeAfterWrite).toHaveLength(7);
  });

  it("never overwrites what the server already has (another device won)", () => {
    const plan = planLocalPrefsMigration(
      { [LEGACY_KEYS.width]: "300", [LEGACY_KEYS.desktop]: "on" },
      { sidebar: { width: 256 }, home: { notifications: { desktop: false } } },
      { now },
    );
    expect(plan.patch).toBeNull();
    expect(plan.removeNow).toEqual(expect.arrayContaining([LEGACY_KEYS.width, LEGACY_KEYS.desktop]));
  });

  it("drops what does not parse instead of guessing", () => {
    const plan = planLocalPrefsMigration(
      { [LEGACY_KEYS.width]: "wide", [LEGACY_KEYS.toolPins]: "{not json", [LEGACY_KEYS.muted]: "0", [LEGACY_KEYS.density]: "huge" },
      null,
      { now },
    );
    expect(plan.patch).toBeNull();
    expect(plan.removeNow).toEqual(expect.arrayContaining([LEGACY_KEYS.width, LEGACY_KEYS.toolPins, LEGACY_KEYS.muted, LEGACY_KEYS.density]));
  });

  it("shares a live local status only when the server has none", () => {
    const pres = JSON.stringify({ emoji: "x", label: "Focusing", expiresAt: "2026-10-01T00:00:00Z" });
    expect(planLocalPrefsMigration({ [LEGACY_KEYS.presence]: pres }, null, { now }).presence).toEqual({ emoji: "x", label: "Focusing", expiresAt: "2026-10-01T00:00:00Z" });
    expect(planLocalPrefsMigration({ [LEGACY_KEYS.presence]: pres }, null, { now, serverPresence: "Away" }).presence).toBeNull();
    const expired = JSON.stringify({ label: "Focusing", expiresAt: "2026-09-01T00:00:00Z" });
    const p = planLocalPrefsMigration({ [LEGACY_KEYS.presence]: expired }, null, { now });
    expect(p.presence).toBeNull();
    expect(p.removeNow).toContain(LEGACY_KEYS.presence);
    expect(planLocalPrefsMigration({ [LEGACY_KEYS.presence]: JSON.stringify({ label: "Online" }) }, null, { now }).presence).toBeNull();
  });

  it("notices any old key cheaply", () => {
    expect(hasLegacyLocalPrefs(() => null)).toBe(false);
    expect(hasLegacyLocalPrefs((k) => (k === LEGACY_KEYS.width ? "280" : null))).toBe(true);
    expect(hasLegacyLocalPrefs(() => { throw new Error("blocked"); })).toBe(false);
  });
});
