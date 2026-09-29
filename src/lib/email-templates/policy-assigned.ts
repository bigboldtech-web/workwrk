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
    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #1F2430; font-weight: 600;">${vars.policyTitle}</p>
      ${vars.dueDate ? `<p style="margin: 8px 0 0; font-size: 12px; color: #5C6779;">Due by: ${vars.dueDate}</p>` : ""}
    </div>
    <p style="text-align: center;">
      <a href="${vars.policyLink}" class="btn">Review &amp; acknowledge</a>
    </p>
  `);

  return {
    subject: `Please acknowledge: ${vars.policyTitle}${vars.dueDate ? ` (due by ${vars.dueDate})` : ""}`,
    html,
  };
}
