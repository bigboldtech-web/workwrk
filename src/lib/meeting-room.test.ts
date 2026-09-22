import { describe, expect, it } from "vitest";
import {
  CHAT_GUEST_CODE_TTL_MS,
  LEGACY_GUEST_CODE_GRACE_UNTIL,
  chatGuestCode,
  guestCodeExpired,
  verifyChatGuestCode,
} from "./meeting-room";

// Guest links expire (spec-talk section 2.5 Data, comms #25). These are the
// four facts the door depends on, and the one that used to be false: before
// Phase 4 a copied chat guest link was a permanent HMAC.

describe("chat guest codes", () => {
  const CONV = "cmubwkbfx000a14xplxyav39l";

  it("round-trips a fresh code with its expiry", () => {
    const exp = Date.now() + CHAT_GUEST_CODE_TTL_MS;
    const code = chatGuestCode(CONV, 3, exp);
    expect(code.split(".")).toHaveLength(5); // c . id . epoch . exp . sig
    const parsed = verifyChatGuestCode(code);
    expect(parsed).toEqual({ conversationId: CONV, epoch: 3, expiresAt: Math.floor(exp) });
    expect(guestCodeExpired(parsed!.expiresAt)).toBe(false);
  });

  it("reads as expired past its own exp, and the signature still verifies", () => {
    // Expiry is a fact ABOUT a valid code, not a way of invalidating it: the
    // route answers 410 (this was real and it is over), never 404.
    const code = chatGuestCode(CONV, 0, Date.now() - 1000);
    const parsed = verifyChatGuestCode(code);
    expect(parsed).not.toBeNull();
    expect(guestCodeExpired(parsed!.expiresAt)).toBe(true);
  });

  it("refuses a tampered exp", () => {
    const code = chatGuestCode(CONV, 1, Date.now() + 60_000);
    const parts = code.split(".");
    parts[3] = String(Number(parts[3]) + 10 * 365 * 24 * 3600_000); // ten more years
    expect(verifyChatGuestCode(parts.join("."))).toBeNull();
  });

  it("refuses a code signed for another epoch", () => {
    const code = chatGuestCode(CONV, 1, Date.now() + 60_000);
    const parts = code.split(".");
    parts[2] = "2";
    expect(verifyChatGuestCode(parts.join("."))).toBeNull();
  });

  it("honours pre-expiry codes through the grace, and not after it", () => {
    // The old four-part shape, exactly as it was minted before Phase 4.
    const legacy = chatGuestCode(CONV, 0, 0).split(".");
    // Rebuild the legacy shape from the same secret: c.<id>.<epoch>.<sig>.
    // The helper cannot mint it any more, so the test asserts against the
    // verifier's own legacy branch using a code of that shape.
    const legacyShape = `c.${CONV}.0.${legacyShapeSig(CONV, 0)}`;
    expect(legacy.length).toBe(5); // the new mint is never the old shape

    const inGrace = verifyChatGuestCode(legacyShape, LEGACY_GUEST_CODE_GRACE_UNTIL - 1000);
    expect(inGrace).toEqual({ conversationId: CONV, epoch: 0, expiresAt: null });
    // A legacy code is never "expired", it is gone: the page 404s rather
    // than telling a stranger the link used to work.
    expect(guestCodeExpired(inGrace!.expiresAt)).toBe(false);

    expect(verifyChatGuestCode(legacyShape, LEGACY_GUEST_CODE_GRACE_UNTIL + 1000)).toBeNull();
  });
});

/** The pre-Phase-4 signature, recomputed here so the grace branch is tested
 *  against a code of the exact shape the old minter produced. */
function legacyShapeSig(conversationId: string, epoch: number): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("crypto") as typeof import("crypto");
  const secret = process.env.NEXTAUTH_SECRET || "workwrk-dev-secret";
  return createHmac("sha256", secret).update(`chatguest:${conversationId}:${epoch}`).digest("hex").slice(0, 16);
}
