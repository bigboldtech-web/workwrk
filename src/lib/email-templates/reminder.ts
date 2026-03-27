import { baseLayout } from "./base";

interface ReminderVars {
  itemType: string; // "Task", "SOP", "Review"
  itemTitle: string;
  dueInfo: string; // "tomorrow", "in 2 days", "overdue by 3 days"
  itemLink: string;
}

export function reminderTemplate(vars: ReminderVars): { subject: string; html: string } {
  const isOverdue = vars.dueInfo.includes("overdue");

  const html = baseLayout(`
    <h1>${isOverdue ? "Overdue" : "Reminder"}: ${vars.itemType}</h1>
    <p>Your ${vars.itemType.toLowerCase()} <span class="highlight">"${vars.itemTitle}"</span> is ${vars.dueInfo}.</p>
    <hr class="divider" />
    <p style="text-align: center;">
      <a href="${vars.itemLink}" class="btn">View ${vars.itemType}</a>
    </p>
  `);

  return {
    subject: `Reminder: ${vars.itemType} '${vars.itemTitle}' is ${vars.dueInfo}`,
    html,
  };
}
