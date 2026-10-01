import { baseLayout, emailButton } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface WelcomeVars {
  firstName: string;
  organizationName: string;
  /** Where the button goes: the workspace itself (the app host's Work home). A signed-out click is sent through /login and back. */
  loginLink: string;
  /** True for the person who just created the workspace: the next steps are the setup ones. */
  isCreator?: boolean;
}

// The next steps name the pages by their registry labels (settings
// registry: Workspace settings > Identity & culture, Members), never the
// retired "Organization > About" and "Settings > Team".
export function welcomeTemplate(vars: WelcomeVars): { subject: string; html: string } {
  const first = escapeHtml(vars.firstName);
  const org = escapeHtml(vars.organizationName);
  const steps = vars.isCreator
    ? `<ul style="font-size:14px;line-height:24px;color:#5C6779;padding-left:20px;margin:0 0 16px;">
      <li>Add your logo and mission in <strong>Workspace settings &gt; Identity &amp; culture</strong></li>
      <li>Invite your team from <strong>Workspace settings &gt; Members</strong></li>
      <li>Open the <strong>General</strong> Space and add your first tasks</li>
    </ul>`
    : `<p>Your profile, notifications and time zone are in <strong>My settings</strong>, under your photo at the top right.</p>`;
  const html = baseLayout(`
    <h1>Welcome to WorkwrK, ${first}</h1>
    <p>Your account in <span class="highlight">${org}</span> is ready.</p>
    ${steps}
    <p style="margin:24px 0 8px;">${emailButton(safeHref(vars.loginLink), "Open WorkwrK")}</p>
    <p class="meta">Need help? Reply to this email.</p>
  `);

  return {
    subject: `Welcome to WorkwrK, ${vars.firstName}`,
    html,
  };
}
