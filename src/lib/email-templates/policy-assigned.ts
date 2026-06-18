import { baseLayout } from "./base";

interface PolicyAssignedVars {
  policyTitle: string;
  dueDate?: string;
  policyLink: string;
}

export function policyAssignedTemplate(vars: PolicyAssignedVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Policy to acknowledge</h1>
    <p>You have been asked to review and acknowledge a policy:</p>
    <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #fafafa; font-weight: 600;">${vars.policyTitle}</p>
      ${vars.dueDate ? `<p style="margin: 8px 0 0; font-size: 12px; color: #a0a0a0;">Due by: ${vars.dueDate}</p>` : ""}
    </div>
    <p style="text-align: center;">
      <a href="${vars.policyLink}" class="btn">Review &amp; acknowledge</a>
    </p>
  `);

  return {
    subject: `Please acknowledge: ${vars.policyTitle}${vars.dueDate ? ` — Due by ${vars.dueDate}` : ""}`,
    html,
  };
}
