import { baseLayout } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface GenericNotificationVars {
  heading: string;             // "Task Assigned", "New Announcement", etc.
  recipientName?: string;
  subjectText: string;         // "Ibrahim assigned you a new task"
  itemTitle: string;           // "Q2 Performance Review"
  itemDetails?: string;        // "Due Mar 15, 2026"
  actionLabel: string;         // "View Task"
  actionLink: string;
  note?: string;               // Optional body note or description
}

export function genericNotificationTemplate(vars: GenericNotificationVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>${escapeHtml(vars.heading)}</h1>
    ${vars.recipientName ? `<p>Hi ${escapeHtml(vars.recipientName)},</p>` : ""}
    <p>${vars.subjectText}</p>
    <div style="margin:16px 0;padding:14px;border:1px solid #E4E7EC;border-radius:10px;background:#F6F7F9;">
      <p style="color:#1F2430;font-size:15px;font-weight:500;margin:0;">${escapeHtml(vars.itemTitle)}</p>
      ${vars.itemDetails ? `<p style="color:#5C6779;font-size:12px;margin:4px 0 0 0;">${escapeHtml(vars.itemDetails)}</p>` : ""}
      ${vars.note ? `<p style="color:#5C6779;font-size:13px;margin:10px 0 0 0;line-height:1.6;">${escapeHtml(vars.note)}</p>` : ""}
    </div>
    <p style="text-align:center;">
      <a href="${safeHref(vars.actionLink)}" class="btn">${escapeHtml(vars.actionLabel)}</a>
    </p>
  `);

  return {
    subject: `${vars.heading}: ${vars.itemTitle}`,
    html,
  };
}
