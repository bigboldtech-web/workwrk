import { baseLayout, emailButton } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface ReminderVars {
  itemType: string; // "Task", "SOP", "Review"
  itemTitle: string;
  dueInfo: string; // "tomorrow", "in 2 days", "overdue by 3 days"
  /** The item's own page (an app-host URL that exists: /item/[id], /sops/[id], ...). */
  itemLink: string;
}

export function reminderTemplate(vars: ReminderVars): { subject: string; html: string } {
  const isOverdue = vars.dueInfo.includes("overdue");
  const type = escapeHtml(vars.itemType);
  const html = baseLayout(`
    <h1>${isOverdue ? "Overdue" : "Reminder"}: ${type}</h1>
    <p>Your ${escapeHtml(vars.itemType.toLowerCase())} <span class="highlight">${escapeHtml(vars.itemTitle)}</span> is ${escapeHtml(vars.dueInfo)}.</p>
    <p style="margin:24px 0 8px;">${emailButton(safeHref(vars.itemLink), `Open ${type}`)}</p>
  `);

  return {
    subject: `Reminder: ${vars.itemType} '${vars.itemTitle}' is ${vars.dueInfo}`,
    html,
  };
}
