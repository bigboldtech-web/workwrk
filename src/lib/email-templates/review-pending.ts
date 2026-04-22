import { baseLayout } from "./base";

interface ReviewPendingVars {
  reviewCycleName: string;
  dueDate: string;
  reviewLink: string;
}

export function reviewPendingTemplate(vars: ReviewPendingVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Self-Assessment Due</h1>
    <p>The review cycle <span class="highlight">${vars.reviewCycleName}</span> has been launched. You need to complete your self-assessment.</p>
    <div style="background: #1a1a1a; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #fafafa; font-size: 13px;">
        <strong>Cycle:</strong> ${vars.reviewCycleName}<br/>
        <strong>Due by:</strong> ${vars.dueDate}
      </p>
    </div>
    <p style="text-align: center;">
      <a href="${vars.reviewLink}" class="btn">Start Self-Assessment</a>
    </p>
  `);

  return {
    subject: `Your ${vars.reviewCycleName} self-assessment is due by ${vars.dueDate}`,
    html,
  };
}
