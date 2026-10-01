import { baseLayout, emailButton } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface PasswordResetVars {
  /** /reset-password?token=... ; the token is hashed at rest and lives 60 minutes. */
  resetLink: string;
  firstName: string;
}

export function passwordResetTemplate(vars: PasswordResetVars): { subject: string; html: string } {
  const href = safeHref(vars.resetLink);
  const html = baseLayout(`
    <h1>Reset your password</h1>
    <p>Hi ${escapeHtml(vars.firstName)}, someone asked to reset the password on your WorkwrK account.</p>
    <p style="margin:24px 0 8px;">${emailButton(href, "Set a new password")}</p>
    <p class="meta">The link works for 60 minutes and only once. Setting a new password logs you out everywhere else. If you did not ask for this, ignore this email: your password stays as it is.</p>
    <p class="meta">If the button does not work, paste this link into your browser:<br/><span class="url" style="word-break:break-all;">${href}</span></p>
  `);

  return {
    subject: "Reset your WorkwrK password",
    html,
  };
}
