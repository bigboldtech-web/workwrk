import { baseLayout } from "./base";

interface EvaluationReminderVars {
  managerName: string;
  teamMembers: string[];
  month: string;
  evaluationLink: string;
}

export function evaluationReminderTemplate(vars: EvaluationReminderVars): { subject: string; html: string } {
  const memberList = vars.teamMembers.map((m) => `<li style="margin-bottom:4px;color:#8888A0;font-size:13px;">${m}</li>`).join("");

  const html = baseLayout(`
    <h1>Monthly Evaluation Reminder</h1>
    <p>Hi ${vars.managerName},</p>
    <p>It's the 1st of <strong class="highlight">${vars.month}</strong>. Time to evaluate your team members' performance for last month.</p>
    <p style="font-size:13px;color:#8888A0;">Your direct reports:</p>
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
