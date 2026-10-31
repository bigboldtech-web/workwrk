// The sole Owner's way back in (scripts/reset-two-step.ts): it resets only
// the one account with this address that can sign in, and refuses a guess.

import { describe, expect, it } from "vitest";
import { pickResetAccount, type ResetCandidate } from "./reset-two-step";

const row = (over: Partial<ResetCandidate> = {}): ResetCandidate => ({
  id: "u1", email: "owner@co.test", organizationId: "o1", deletedAt: null, status: "ACTIVE", mfaEnabled: true, ...over,
});

describe("pickResetAccount", () => {
  it("picks the one account that can sign in, past removed and deactivated ones", () => {
    const pick = pickResetAccount([row({ id: "gone", deletedAt: new Date() }), row({ id: "off", status: "INACTIVE" }), row()], null);
    expect(pick).toEqual({ ok: true, row: row() });
  });

  it("refuses two live accounts unless the workspace is named", () => {
    const rows = [row(), row({ id: "u2", organizationId: "o2" })];
    expect(pickResetAccount(rows, null).ok).toBe(false);
    expect(pickResetAccount(rows, "o2")).toEqual({ ok: true, row: row({ id: "u2", organizationId: "o2" }) });
  });

  it("refuses an address with no live account, and one whose two step verification is off", () => {
    expect(pickResetAccount([row({ deletedAt: new Date() })], null).ok).toBe(false);
    expect(pickResetAccount([row({ mfaEnabled: false })], null)).toEqual({ ok: false, reason: "Two step verification is already off for this account." });
  });
});
