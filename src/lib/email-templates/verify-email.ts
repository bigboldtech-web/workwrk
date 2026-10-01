import { baseLayout, emailButton } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface VerifyEmailVars {
  firstName: string;
  /** /verify-email?token=... ; the token is hashed at rest and lives 24 hours. */
  verifyUrl: string;
}

// Replaces the inline dark and lime copy that lived in
// src/app/api/auth/request-verify/route.ts. Sent at signup and whenever a
// person asks for a new link (/verify-email?resend=1, My settings).
export function verifyEmailTemplate(vars: VerifyEmailVars): { subject: string; html: string } {
  const href = safeHref(vars.verifyUrl);
  const html = baseLayout(`
    <h1>Confirm your email</h1>
    <p>Hi ${escapeHtml(vars.firstName)}, confirm this address so your team can reach you and you can reset your password if you ever need to.</p>
    <p style="margin:24px 0 8px;">${emailButton(href, "Confirm my email")}</p>
    <p class="meta">The link works for 24 hours. If you did not create a WorkwrK account, ignore this email.</p>
    <p class="meta">If the button does not work, paste this link into your browser:<br/><span class="url" style="word-break:break-all;">${href}</span></p>
  `);
  return { subject: "Confirm your WorkwrK email", html };
}
