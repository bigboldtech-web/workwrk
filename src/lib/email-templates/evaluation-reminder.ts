import { baseLayout } from "./base";

interface EvaluationReminderVars {
  managerName: string;
  teamMembers: string[];
  /** The month being evaluated, last month ("October 2026"): it is sent on the 1st of the next. */
  month: string;
  evaluationLink: string;
}

export function evaluationReminderTemplate(vars: EvaluationReminderVars): { subject: string; html: string } {
  const memberList = vars.teamMembers.map((m) => `<li style="margin-bottom:4px;color:#5C6779;font-size:13px;">${m}</li>`).join("");

  const html = baseLayout(`
    <h1>Monthly Evaluation Reminder</h1>
    <p>Hi ${vars.managerName},</p>
    <p>It's time to review your team's performance for <strong class="highlight">${vars.month}</strong>.</p>
    <p style="font-size:13px;color:#5C6779;">Your direct reports:</p>
    <ul style="padding-left:20px;margin-bottom:16px;">${memberList}</ul>
    <hr class="divider" />
    <p style="text-align:center;">
      <a href="${vars.evaluationLink}" class="btn">Start Evaluations</a>
    </p>
    <p class="meta">Review their KPI records, task completion, and SOP compliance before scoring.</p>
  `);

  return {
    subject: `Action Required: Evaluate your team for ${vars.month}`,
    html,
  };
}
