import { baseLayout } from "./base";

interface SOPAssignedVars {
  sopTitle: string;
  dueDate?: string;
  sopLink: string;
}

export function sopAssignedTemplate(vars: SOPAssignedVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>New SOP assigned</h1>
    <p>You have been assigned a new Standard Operating Procedure to complete:</p>
    <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #fafafa; font-weight: 600;">${vars.sopTitle}</p>
      ${vars.dueDate ? `<p style="margin: 8px 0 0; font-size: 12px; color: #a0a0a0;">Due by: ${vars.dueDate}</p>` : ""}
    </div>
    <p style="text-align: center;">
      <a href="${vars.sopLink}" class="btn">View SOP</a>
    </p>
  `);

  return {
    subject: `New SOP assigned: ${vars.sopTitle}${vars.dueDate ? ` — Due by ${vars.dueDate}` : ""}`,
    html,
  };
}
