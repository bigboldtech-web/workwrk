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
    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 8px; padding: 20px; margin: 16px 0; border-left: 3px solid #0073EA;">
      <p style="margin: 0; color: #1F2430; font-style: italic; font-size: 15px;">"${vars.message}"</p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #5C6779;">From ${vars.senderName}</p>
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
