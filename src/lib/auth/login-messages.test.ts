import { describe, expect, it } from "vitest";
import { friendlyError, loginNotice, normaliseMfaCode } from "./login-messages";

describe("friendlyError", () => {
  it("keeps the lockout countdown and never says which half was wrong", () => {
    expect(friendlyError("Too many failed attempts. Try again in 12 minutes.")).toBe("Too many attempts. Try again in 12 minutes.");
    expect(friendlyError("Too many failed attempts. Try again in 1 minute.")).toBe("Too many attempts. Try again in 1 minute.");
    expect(friendlyError("CredentialsSignin")).toBe("That email or password is not right.");
    expect(friendlyError("Invalid credentials")).toBe("That email or password is not right.");
  });

  it("maps the account and workspace refusals", () => {
    expect(friendlyError("This account is no longer active. Contact your workspace admin.")).toBe("This account is not active. Ask your workspace admin.");
    expect(friendlyError("This workspace is suspended. Please contact WorkwrK support.")).toBe("That workspace is suspended. Ask your workspace admin.");
    expect(friendlyError("This workspace is closed. Please contact WorkwrK support.")).toBe("That workspace is closed. Ask your workspace admin.");
    expect(friendlyError("Invalid authentication code")).toBe("That code is not right. Try again.");
  });

  it("gives every NextAuth ?error= value copy", () => {
    expect(friendlyError("AccessDenied", { email: "a@b.co" })).toContain("invite a@b.co");
    expect(friendlyError("OAuthAccountNotLinked")).toContain("password");
    for (const code of ["OAuthSignin", "OAuthCallback", "Callback"]) expect(friendlyError(code)).toContain("Google");
    expect(friendlyError("Configuration")).toBe("We could not log you in. Try again in a moment.");
  });

  it("never echoes an unknown server string", () => {
    expect(friendlyError("TypeError: cannot read x of undefined at line 4")).toBe("That email or password is not right.");
    expect(friendlyError("<script>")).not.toContain("<script>");
  });
});

describe("loginNotice", () => {
  it("reads the one-time flags, ?registered=true as ?signedup=1", () => {
    expect(loginNotice(new URLSearchParams("signedup=1"))?.text).toBe("Workspace created. Log in to continue.");
    expect(loginNotice(new URLSearchParams("registered=true"))?.text).toBe("Workspace created. Log in to continue.");
    expect(loginNotice(new URLSearchParams("reset=1"))?.text).toContain("Password changed");
    expect(loginNotice(new URLSearchParams("verified=1"))?.text).toBe("Email verified.");
    expect(loginNotice(new URLSearchParams("deleted=1"))?.text).toBe("Your account has been deleted.");
    expect(loginNotice(new URLSearchParams("token=abc"))).toBeNull();
  });
});

describe("normaliseMfaCode", () => {
  it("strips spaces and hyphens from an authenticator code", () => {
    expect(normaliseMfaCode("123 456")).toBe("123456");
    expect(normaliseMfaCode(" 123-456 ")).toBe("123456");
  });

  it("keeps a backup code in its stored ABCD-EFGH shape", () => {
    expect(normaliseMfaCode("abcd-efgh")).toBe("ABCD-EFGH");
    expect(normaliseMfaCode("ABCD EFGH")).toBe("ABCD-EFGH");
    expect(normaliseMfaCode("abcdefgh")).toBe("ABCD-EFGH");
  });
});
