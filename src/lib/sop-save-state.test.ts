import { describe, expect, it } from "vitest";
import { deriveSopSaveState, isMeaningfulFirstChange, nextRetryDelay } from "./sop-save-state";

const base = { saving: false, failed: false, retrying: false, dirty: false, autosaves: true, lastSaved: null as Date | null };

describe("deriveSopSaveState (one state per autosave contract)", () => {
  it("idle: nothing typed, nothing saved", () => {
    expect(deriveSopSaveState(base)).toEqual({ status: "idle", showRetry: false, showSaveBar: false, leaveGuard: false });
  });
  it("saving: the dot pulses, the guard is armed, no bar on a draft", () => {
    expect(deriveSopSaveState({ ...base, saving: true })).toEqual({ status: "saving", showRetry: false, showSaveBar: false, leaveGuard: true });
    expect(deriveSopSaveState({ ...base, saving: true, autosaves: false })).toMatchObject({ status: "saving", showSaveBar: true });
  });
  it("saved: the word shows and the guard drops", () => {
    expect(deriveSopSaveState({ ...base, lastSaved: new Date() })).toEqual({ status: "saved", showRetry: false, showSaveBar: false, leaveGuard: false });
  });
  it("failed with retries pending: 'Not saved, retrying', no Retry link yet", () => {
    expect(deriveSopSaveState({ ...base, failed: true, retrying: true })).toEqual({ status: "error", showRetry: false, showSaveBar: true, leaveGuard: true });
  });
  it("failed with the budget spent: 'Not saved' plus Retry", () => {
    expect(deriveSopSaveState({ ...base, failed: true, retrying: false })).toEqual({ status: "error", showRetry: true, showSaveBar: true, leaveGuard: true });
  });
  it("dirty on a published SOP shows the save bar; on a draft the autosave will pick it up", () => {
    expect(deriveSopSaveState({ ...base, dirty: true, autosaves: false })).toEqual({ status: "dirty", showRetry: false, showSaveBar: true, leaveGuard: true });
    expect(deriveSopSaveState({ ...base, dirty: true, autosaves: true })).toMatchObject({ status: "dirty", showSaveBar: false, leaveGuard: true });
  });
  it("saving wins over failed, failed wins over dirty", () => {
    expect(deriveSopSaveState({ ...base, saving: true, failed: true, dirty: true }).status).toBe("saving");
    expect(deriveSopSaveState({ ...base, failed: true, dirty: true }).status).toBe("error");
  });
});

describe("nextRetryDelay", () => {
  it("doubles from 800ms and gives up after four attempts", () => {
    expect(nextRetryDelay(0)).toBe(800);
    expect(nextRetryDelay(1)).toBe(1600);
    expect(nextRetryDelay(2)).toBe(3200);
    expect(nextRetryDelay(3)).toBeNull();
  });
});

describe("isMeaningfulFirstChange (create-on-first-change)", () => {
  it("writes nothing for a blank page", () => {
    expect(isMeaningfulFirstChange("", false)).toBe(false);
    expect(isMeaningfulFirstChange("   ", false)).toBe(false);
    expect(isMeaningfulFirstChange("Onboarding", false)).toBe(true);
    expect(isMeaningfulFirstChange("", true)).toBe(true);
  });
});
