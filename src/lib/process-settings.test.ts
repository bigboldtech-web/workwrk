import { describe, expect, it } from "vitest";
import {
  CONTRACT_FOLDER_SEEDS,
  DEFAULT_ACK_STATEMENT,
  POLICY_CATEGORY_SEEDS,
  addListEntry,
  dedupeNames,
  defaultAckDueDate,
  parseProcessSettings,
  processSettingsPatchSchema,
  removeListEntry,
  renameListEntry,
} from "./process-settings";

describe("parseProcessSettings", () => {
  it("seeds both lists from the two legacy CATEGORY_OPTIONS arrays when the section is absent", () => {
    const { value, seeded } = parseProcessSettings(undefined);
    expect(seeded).toBe(true);
    expect(value.policyCategories).toEqual([...POLICY_CATEGORY_SEEDS]);
    expect(value.contractFolders).toEqual([...CONTRACT_FOLDER_SEEDS]);
    expect(value.ackStatement).toBe(DEFAULT_ACK_STATEMENT);
    expect(value.ackDueDays).toBeNull();
    expect(value.ackRemindDays).toBe(0);
  });

  it("does not reseed once both lists exist, even when one is empty", () => {
    const { value, seeded } = parseProcessSettings({ policyCategories: [], contractFolders: ["NDA"] });
    expect(seeded).toBe(false);
    expect(value.policyCategories).toEqual([]);
    expect(value.contractFolders).toEqual(["NDA"]);
  });

  it("marks seeded when only one list is present", () => {
    const { value, seeded } = parseProcessSettings({ policyCategories: ["HR"] });
    expect(seeded).toBe(true);
    expect(value.policyCategories).toEqual(["HR"]);
    expect(value.contractFolders).toEqual([...CONTRACT_FOLDER_SEEDS]);
  });

  it("reads the acknowledgement defaults and rejects garbage silently", () => {
    const { value } = parseProcessSettings({ policyCategories: [], contractFolders: [], ackStatement: "  I agree.  ", ackDueDays: 14, ackRemindDays: -3 });
    expect(value.ackStatement).toBe("I agree.");
    expect(value.ackDueDays).toBe(14);
    expect(value.ackRemindDays).toBe(0);
  });
});

describe("processSettingsPatchSchema", () => {
  it("accepts a partial patch", () => {
    expect(processSettingsPatchSchema.safeParse({ ackDueDays: 7 }).success).toBe(true);
    expect(processSettingsPatchSchema.safeParse({ ackDueDays: null }).success).toBe(true);
  });
  it("refuses an unknown key (strict) and a bad value", () => {
    expect(processSettingsPatchSchema.safeParse({ ackDue: 7 }).success).toBe(false);
    expect(processSettingsPatchSchema.safeParse({ ackRemindDays: 400 }).success).toBe(false);
    expect(processSettingsPatchSchema.safeParse({ policyCategories: [""] }).success).toBe(false);
  });
});

describe("list edits", () => {
  it("dedupes case-insensitively, first spelling wins", () => {
    expect(dedupeNames(["HR", " hr ", "Security", "", "security"])).toEqual(["HR", "Security"]);
  });
  it("renames everywhere and merges onto an existing name", () => {
    expect(renameListEntry(["HR", "Ops"], "Ops", "Operations")).toEqual(["HR", "Operations"]);
    expect(renameListEntry(["HR", "Ops"], "Ops", "hr")).toEqual(["HR"]);
    expect(renameListEntry(["HR", "Ops"], "Ops", "   ")).toEqual(["HR", "Ops"]);
  });
  it("adds and removes", () => {
    expect(addListEntry(["HR"], "Legal")).toEqual(["HR", "Legal"]);
    expect(addListEntry(["HR"], "hr")).toEqual(["HR"]);
    expect(removeListEntry(["HR", "Legal"], "HR")).toEqual(["Legal"]);
  });
});

describe("defaultAckDueDate", () => {
  const now = new Date("2026-09-21T10:00:00Z");
  it("is null when unset or zero", () => {
    expect(defaultAckDueDate(null, now)).toBeNull();
    expect(defaultAckDueDate(0, now)).toBeNull();
  });
  it("adds the days", () => {
    expect(defaultAckDueDate(14, now)).toBe("2026-10-05");
  });
});
