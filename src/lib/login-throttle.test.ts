import { describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  clearLoginFailuresForEmail,
  effectiveLockout,
  loginLockRemaining,
  recordLoginFailure,
  throttleKey,
} from "./login-throttle";

// Each test uses its own emails, because the buckets live in one module-level
// Map that is shared across the file.
function lock(key: string): void {
  for (let i = 0; i < 8; i++) recordLoginFailure(key);
}

describe("login lockout", () => {
  it("locks a key after eight failures and a sign-in clears it", () => {
    const key = throttleKey("10.0.0.1", "lock.basic@example.com");
    lock(key);
    expect(loginLockRemaining(key)).toBeGreaterThan(14 * 60);
    clearLoginFailures(key);
    expect(loginLockRemaining(key)).toBe(0);
  });

  it("never lets a workspace weaken the built-in floor", () => {
    expect(effectiveLockout({ lockoutThreshold: 50, lockoutMinutes: 1 })).toEqual({ maxFails: 8, lockMs: 15 * 60 * 1000 });
  });
});

describe("clearLoginFailuresForEmail (a successful password reset)", () => {
  it("lifts the lockout from every IP the failures came from", () => {
    const phone = throttleKey("203.0.113.5", "si.case@example.com");
    const office = throttleKey("198.51.100.7", "si.case@example.com");
    lock(phone);
    lock(office);
    expect(loginLockRemaining(phone)).toBeGreaterThan(0);
    expect(loginLockRemaining(office)).toBeGreaterThan(0);

    // The reset link is opened from a third device: its own IP is not one
    // of the locked keys, and the email is spelled differently.
    clearLoginFailuresForEmail("  Si.Case@Example.com ");

    expect(loginLockRemaining(phone)).toBe(0);
    expect(loginLockRemaining(office)).toBe(0);
  });

  it("leaves every other account locked, including one whose email ends the same way", () => {
    const other = throttleKey("203.0.113.5", "someone.else@example.com");
    const lookalike = throttleKey("203.0.113.5", "a|reset.me@example.com");
    const mine = throttleKey("203.0.113.5", "reset.me@example.com");
    lock(other);
    lock(lookalike);
    lock(mine);

    clearLoginFailuresForEmail("reset.me@example.com");

    expect(loginLockRemaining(mine)).toBe(0);
    expect(loginLockRemaining(other)).toBeGreaterThan(0);
    expect(loginLockRemaining(lookalike)).toBeGreaterThan(0);
  });

  it("is not fooled by a forged IP header that contains a '|'", () => {
    // Without the IP sanitising, this key would read as "1.2.3.4|x|victim..."
    // and its email part would look like "x|victim@example.com".
    const forged = throttleKey("1.2.3.4|x", "victim@example.com");
    lock(forged);
    clearLoginFailuresForEmail("victim@example.com");
    expect(loginLockRemaining(forged)).toBe(0);
  });
});
