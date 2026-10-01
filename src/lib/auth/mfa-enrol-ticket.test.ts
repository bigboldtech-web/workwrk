import { describe, expect, it } from "vitest";
import { ENROL_TICKET_TTL_MS, enrolRequiredError, enrolTicketUserId, issueEnrolTicket, ticketFromLoginError, verifyEnrolTicket } from "./mfa-enrol-ticket";

const KEY = "test-secret";
const NOW = 1_800_000_000_000;

describe("the login enrolment ticket", () => {
  it("verifies for the same person at the same tokenVersion within ten minutes", () => {
    const t = issueEnrolTicket("u1", 3, NOW, KEY)!;
    expect(enrolTicketUserId(t)).toBe("u1");
    expect(verifyEnrolTicket(t, { userId: "u1", tokenVersion: 3 }, NOW + 1000, KEY)).toBe(true);
  });
  it("dies when the tokenVersion moves (log out everywhere, reset, suspension)", () => {
    const t = issueEnrolTicket("u1", 3, NOW, KEY)!;
    expect(verifyEnrolTicket(t, { userId: "u1", tokenVersion: 4 }, NOW + 1000, KEY)).toBe(false);
  });
  it("dies after ten minutes", () => {
    const t = issueEnrolTicket("u1", 3, NOW, KEY)!;
    expect(verifyEnrolTicket(t, { userId: "u1", tokenVersion: 3 }, NOW + ENROL_TICKET_TTL_MS + 1, KEY)).toBe(false);
  });
  it("cannot be moved to another person or forged", () => {
    const t = issueEnrolTicket("u1", 3, NOW, KEY)!;
    expect(verifyEnrolTicket(t, { userId: "u2", tokenVersion: 3 }, NOW, KEY)).toBe(false);
    const [, exp, sig] = t.split(".");
    expect(verifyEnrolTicket(`u2.${exp}.${sig}`, { userId: "u2", tokenVersion: 3 }, NOW, KEY)).toBe(false);
    expect(verifyEnrolTicket(t, { userId: "u1", tokenVersion: 3 }, NOW, "other-secret")).toBe(false);
    expect(verifyEnrolTicket("garbage", { userId: "u1", tokenVersion: 3 }, NOW, KEY)).toBe(false);
  });
  it("refuses a far-future expiry even with a valid signature shape", () => {
    const t = issueEnrolTicket("u1", 3, NOW + 60 * 60 * 1000, KEY)!;
    expect(verifyEnrolTicket(t, { userId: "u1", tokenVersion: 3 }, NOW, KEY)).toBe(false);
  });
  it("is never issued without a secret", () => {
    expect(issueEnrolTicket("u1", 3, NOW, "")).toBeNull();
  });
  it("round-trips through the login error string", () => {
    const t = issueEnrolTicket("u1", 3, NOW, KEY)!;
    expect(ticketFromLoginError(enrolRequiredError(t))).toBe(t);
    expect(ticketFromLoginError("MFA_REQUIRED")).toBeNull();
    expect(ticketFromLoginError(null)).toBeNull();
  });
});
