import { baseLayout } from "./base";

interface KudosVars {
  senderName: string;
  message: string;
  dashboardLink: string;
}

export function kudosTemplate(vars: KudosVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>You received recognition!</h1>
    <p><span class="highlight">${vars.senderName}</span> recognized you:</p>
    <div style="background: #1A1A26; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 3px solid #d4ff2e;">
      <p style="margin: 0; color: #E8E8F0; font-style: italic; font-size: 15px;">"${vars.message}"</p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #8888A0;">— ${vars.senderName}</p>
    </div>
    <p style="text-align: center;">
      <a href="${vars.dashboardLink}" class="btn">View Dashboard</a>
    </p>
  `);

  return {
    subject: `${vars.senderName} recognized you: '${vars.message.slice(0, 60)}${vars.message.length > 60 ? "..." : ""}'`,
    html,
  };
}
