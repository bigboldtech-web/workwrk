import { baseLayout } from "./base";

interface WelcomeVars {
  firstName: string;
  organizationName: string;
  loginLink: string;
}

export function welcomeTemplate(vars: WelcomeVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Welcome to WorkwrK, ${vars.firstName}!</h1>
    <p>Your account for <span class="highlight">${vars.organizationName}</span> has been created successfully.</p>
    <p>WorkwrK is your business operating system — manage people, KRAs, KPIs, SOPs, OKRs, reviews, and more, all aligned in one place.</p>
    <p>Here's what to do next:</p>
    <ul style="font-size: 14px; line-height: 1.8; color: #a0a0a0; padding-left: 20px;">
      <li>Complete your company profile in <strong>Organization → About</strong></li>
      <li>Invite your team from <strong>Settings → Team</strong></li>
      <li>Generate KRAs &amp; KPIs with AI for your roles</li>
      <li>Set up your first SOPs and policies</li>
    </ul>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${vars.loginLink}" class="btn">Go to Dashboard</a>
    </p>
    <p class="meta">If you need help, just reply to this email.</p>
  `);

  return {
    subject: `Welcome to WorkwrK, ${vars.firstName}!`,
    html,
  };
}
