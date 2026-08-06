import { baseLayout } from "./base";

interface InvitationVars {
  companyName: string;
  inviteLink: string;
  accessLevel: string;
  /** Optional note from the inviter — rendered as a quoted block. */
  personalMessage?: string;
}

// Personal messages are free-form user input headed into an HTML email —
// escape them so nobody can smuggle markup into the invite.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function invitationTemplate(vars: InvitationVars): { subject: string; html: string } {
  const messageBlock = vars.personalMessage?.trim()
    ? `<p style="border-left: 3px solid #0073EA; padding: 8px 12px; background: #f4f6f8; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(vars.personalMessage.trim())}</p>`
    : "";
  const html = baseLayout(`
    <h1>You've been invited!</h1>
    <p><span class="highlight">${vars.companyName}</span> has invited you to join their team on WorkwrK as <strong>${vars.accessLevel.replace(/_/g, " ")}</strong>.</p>
    ${messageBlock}
    <p>WorkwrK is a Business Operating System that helps teams manage performance, tasks, SOPs, and more — all in one place.</p>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${vars.inviteLink}" class="btn">Accept Invitation</a>
    </p>
    <p class="meta">This invitation expires in 7 days. If the button doesn't work, copy and paste this link into your browser:<br/>${vars.inviteLink}</p>
  `);

  return {
    subject: `You've been invited to join ${vars.companyName} on WorkwrK`,
    html,
  };
}
