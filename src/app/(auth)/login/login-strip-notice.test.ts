import { describe, expect, it } from "vitest";
import { loginStripNotice } from "./login-form";

// The strip above /login. "You were logged out" is a guess (a callbackUrl
// plus a remembered email), so it must never sit under "Logged in as X".
describe("loginStripNotice", () => {
  const explicit = { tone: "success" as const, text: "Your password was changed. Log in with the new one." };

  it("shows the logged out guess only when the session is really gone", () => {
    expect(loginStripNotice(null, true, "unauthenticated")?.text).toBe("You were logged out. Log in to pick up where you left off.");
  });

  it("hides the guess for a person who is still signed in", () => {
    expect(loginStripNotice(null, true, "authenticated")).toBeNull();
  });

  it("holds the guess back while the session is loading, so it never flashes", () => {
    expect(loginStripNotice(null, true, "loading")).toBeNull();
  });

  it("shows nothing when nothing suggests a logout", () => {
    expect(loginStripNotice(null, false, "unauthenticated")).toBeNull();
  });

  it("keeps explicit flags exactly as they are, signed in or not", () => {
    expect(loginStripNotice(explicit, false, "authenticated")).toBe(explicit);
    expect(loginStripNotice(explicit, true, "unauthenticated")).toBe(explicit);
    expect(loginStripNotice(explicit, true, "loading")).toBe(explicit);
  });
});
