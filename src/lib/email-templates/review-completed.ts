import { baseLayout } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface ReviewCompletedVars {
  reviewCycleName: string;
  reviewLink: string;
}

export function reviewCompletedTemplate(vars: ReviewCompletedVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Your review is complete</h1>
    <p>Your <span class="highlight">${escapeHtml(vars.reviewCycleName)}</span> review has been finalized. You can now view your results and feedback.</p>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${safeHref(vars.reviewLink)}" class="btn">View Results</a>
    </p>
  `);

  return {
    subject: `Your ${vars.reviewCycleName} review is complete. View your results.`,
    html,
  };
}
