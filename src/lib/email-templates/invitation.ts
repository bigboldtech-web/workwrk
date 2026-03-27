import { baseLayout } from "./base";

interface InvitationVars {
  companyName: string;
  inviteLink: string;
  accessLevel: string;
}

export function invitationTemplate(vars: InvitationVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>You've been invited!</h1>
    <p><span class="highlight">${vars.companyName}</span> has invited you to join their team on TheywrK as <strong>${vars.accessLevel.replace(/_/g, " ")}</strong>.</p>
    <p>TheywrK is a Business Operating System that helps teams manage performance, tasks, SOPs, and more — all in one place.</p>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${vars.inviteLink}" class="btn">Accept Invitation</a>
    </p>
    <p class="meta">This invitation expires in 7 days. If the button doesn't work, copy and paste this link into your browser:<br/>${vars.inviteLink}</p>
  `);

  return {
    subject: `You've been invited to join ${vars.companyName} on TheywrK`,
    html,
  };
}
