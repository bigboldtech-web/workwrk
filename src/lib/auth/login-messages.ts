// What /login says, as one pure table (spec-account-auth `/login` States).
//
//   friendlyError(code)  a credentials `authorize` outcome, or a NextAuth
//                        `?error=` value, as the one banner line. Deliberately
//                        vague about which half of the credentials was wrong,
//                        and never a raw server message: an unknown value
//                        collapses to a generic line.
//   loginNotice(params)  the one-time strips the query flags ask for
//                        (?signedup=1, ?reset=1, ...), which the page strips
//                        from the URL after showing once.
//
// The lockout, inactive-account and suspended-workspace lines come from
// src/lib/auth.ts authorize() already worded for a person; they pass through
// so the countdown stays exact.

export type LoginNotice = { tone: "success" | "info"; text: string };

export function friendlyError(code: string | null | undefined, opts: { email?: string | null } = {}): string {
  const err = (code ?? "").trim();
  if (!err) return "We could not log you in. Try again in a moment.";
  if (err.startsWith("Too many failed attempts")) {
    const mins = /in (\d+) minute/.exec(err)?.[1];
    return mins ? `Too many attempts. Try again in ${mins} minute${mins === "1" ? "" : "s"}.` : "Too many attempts. Try again in a few minutes.";
  }
  if (err.startsWith("This account")) return "This account is not active. Ask your workspace admin.";
  if (err.startsWith("This workspace is suspended")) return "That workspace is suspended. Ask your workspace admin.";
  if (err.startsWith("This workspace")) return "That workspace is closed. Ask your workspace admin.";
  if (err === "Invalid authentication code") return "That code is not right. Try again.";
  if (err === "Missing credentials") return "Enter your email and password.";
  if (err === "CredentialsSignin" || err === "Invalid credentials") return "That email or password is not right.";
  // NextAuth's own ?error= values (the Google button's refusals and config).
  if (err === "AccessDenied") {
    const who = opts.email ? ` ${opts.email}` : "";
    return `That Google account is not on WorkwrK. Ask your workspace admin to invite${who || " you"}, or log in with your email and password.`;
  }
  if (err === "OAuthAccountNotLinked") return "That email already logs in with a password. Use your password below.";
  if (err === "OAuthSignin" || err === "OAuthCallback" || err === "Callback" || err === "OAuthCreateAccount") {
    return "We could not finish logging you in with Google. Try again, or use your password.";
  }
  if (err === "SessionRequired") return "Log in to continue.";
  if (err === "Configuration") return "We could not log you in. Try again in a moment.";
  return "That email or password is not right.";
}

/** NextAuth writes these into ?error= itself; everything else is not a NextAuth outcome and is shown as the generic line. */
export const NEXTAUTH_ERROR_CODES = new Set([
  "AccessDenied", "OAuthAccountNotLinked", "OAuthSignin", "OAuthCallback", "Callback",
  "OAuthCreateAccount", "SessionRequired", "Configuration", "CredentialsSignin", "Verification", "Default",
]);

/** The one-time success or info strip for the query flags, or null. */
export function loginNotice(params: URLSearchParams): LoginNotice | null {
  if (params.get("signedup") === "1" || params.get("registered") === "true") {
    return { tone: "success", text: "Workspace created. Log in to continue." };
  }
  if (params.get("reset") === "1") return { tone: "success", text: "Password changed. Log in with your new password." };
  if (params.get("verified") === "1") return { tone: "success", text: "Email verified." };
  if (params.get("deleted") === "1") return { tone: "info", text: "Your account has been deleted." };
  if (params.get("loggedout") === "1") return { tone: "info", text: "You are logged out." };
  if (params.get("expired") === "1" || (params.get("callbackUrl") && params.get("reason") === "expired")) {
    return { tone: "info", text: "You were logged out. Log in to pick up where you left off." };
  }
  return null;
}

/** The flags loginNotice and the error banner read, which the page strips after showing once. callbackUrl is kept. */
export const ONE_TIME_LOGIN_FLAGS = ["signedup", "registered", "reset", "verified", "deleted", "loggedout", "expired", "reason", "error"] as const;

/**
 * A pasted code in the shape the server compares. An authenticator code
 * loses its spaces and hyphens ("123 456" and "123-456" become "123456").
 * A backup code is stored as "ABCD-EFGH" (src/app/api/auth/mfa/enroll) and
 * compared exactly, so it is upper-cased, loses its spaces and gets its
 * hyphen back when it was typed without one; nothing else is changed.
 */
export function normaliseMfaCode(raw: string): string {
  const compact = raw.replace(/\s+/g, "");
  const digits = compact.replace(/-/g, "");
  if (/^\d+$/.test(digits)) return digits;
  const upper = compact.toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(upper)) return `${upper.slice(0, 4)}-${upper.slice(4)}`;
  return upper;
}
