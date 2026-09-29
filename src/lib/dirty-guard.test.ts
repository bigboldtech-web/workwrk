import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDirty, confirmLeave, leaveThen, registerDirty, setLeaveConfirmer } from "./dirty-guard";

afterEach(() => {
  clearDirty();
  setLeaveConfirmer(null);
});

describe("leaveThen", () => {
  it("navigates in the same tick when nothing is dirty, without asking", async () => {
    const ask = vi.fn();
    setLeaveConfirmer(ask);
    const go = vi.fn();
    const p = leaveThen(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    await expect(p).resolves.toBe(true);
  });

  it("asks first when something is dirty and stays on Keep editing", async () => {
    registerDirty("form");
    const ask = vi.fn().mockResolvedValue("stay");
    setLeaveConfirmer(ask);
    const go = vi.fn();
    await expect(leaveThen(go)).resolves.toBe(false);
    expect(ask).toHaveBeenCalledWith({ count: 1 });
    expect(go).not.toHaveBeenCalled();
  });

  it("navigates after Discard", async () => {
    registerDirty("form");
    setLeaveConfirmer(() => Promise.resolve("discard"));
    const go = vi.fn();
    const p = leaveThen(go);
    expect(go).not.toHaveBeenCalled();
    await expect(p).resolves.toBe(true);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("navigates after Save only when every save succeeded", async () => {
    registerDirty("a", { onSave: () => true });
    registerDirty("b", { onSave: () => Promise.resolve(false) });
    setLeaveConfirmer(() => Promise.resolve("save"));
    const go = vi.fn();
    await expect(leaveThen(go)).resolves.toBe(false);
    expect(go).not.toHaveBeenCalled();

    clearDirty();
    registerDirty("a", { onSave: () => Promise.resolve(true) });
    await expect(leaveThen(go)).resolves.toBe(true);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("a save that throws keeps the person here", async () => {
    registerDirty("a", { onSave: () => Promise.reject(new Error("offline")) });
    setLeaveConfirmer(() => Promise.resolve("save"));
    const go = vi.fn();
    await expect(leaveThen(go)).resolves.toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("a question that throws counts as Keep editing", async () => {
    registerDirty("form");
    setLeaveConfirmer(() => Promise.reject(new Error("unmounted")));
    const go = vi.fn();
    await expect(leaveThen(go)).resolves.toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("agrees with confirmLeave once the form is clean again", async () => {
    const unregister = registerDirty("form");
    unregister();
    await expect(confirmLeave()).resolves.toBe(true);
    const go = vi.fn();
    leaveThen(go);
    expect(go).toHaveBeenCalledTimes(1);
  });
});
