import { baseLayout } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface ReviewPendingVars {
  reviewCycleName: string;
  dueDate: string;
  reviewLink: string;
}

export function reviewPendingTemplate(vars: ReviewPendingVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Self-Assessment Due</h1>
    <p>The review cycle <span class="highlight">${escapeHtml(vars.reviewCycleName)}</span> has been launched. You need to complete your self-assessment.</p>
    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #1F2430; font-size: 13px;">
        <strong>Cycle:</strong> ${escapeHtml(vars.reviewCycleName)}<br/>
        <strong>Due by:</strong> ${escapeHtml(vars.dueDate)}
      </p>
    </div>
    <p style="text-align: center;">
      <a href="${safeHref(vars.reviewLink)}" class="btn">Start Self-Assessment</a>
    </p>
  `);

  return {
    subject: `Your ${vars.reviewCycleName} self-assessment is due by ${vars.dueDate}`,
    html,
  };
}
