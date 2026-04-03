import { baseLayout } from "./base";

interface PasswordResetVars {
  resetLink: string;
  firstName: string;
}

export function passwordResetTemplate(vars: PasswordResetVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Reset your password</h1>
    <p>Hi <span class="highlight">${vars.firstName}</span>, we received a request to reset your password.</p>
    <p>Click the button below to choose a new password:</p>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${vars.resetLink}" class="btn">Reset Password</a>
    </p>
    <p class="meta">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    <p class="meta">If the button doesn't work, copy and paste this link into your browser:<br/>${vars.resetLink}</p>
  `);

  return {
    subject: "Reset your WorkwrK password",
    html,
  };
}
