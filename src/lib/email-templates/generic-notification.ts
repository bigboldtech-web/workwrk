import { baseLayout } from "./base";

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
    <h1>${vars.heading}</h1>
    ${vars.recipientName ? `<p>Hi ${vars.recipientName},</p>` : ""}
    <p>${vars.subjectText}</p>
    <div style="margin:16px 0;padding:14px;border:1px solid #1f1f1f;border-radius:10px;background:#141414;">
      <p style="color:#fafafa;font-size:15px;font-weight:500;margin:0;">${vars.itemTitle}</p>
      ${vars.itemDetails ? `<p style="color:#a0a0a0;font-size:12px;margin:4px 0 0 0;">${vars.itemDetails}</p>` : ""}
      ${vars.note ? `<p style="color:#a0a0a0;font-size:13px;margin:10px 0 0 0;line-height:1.6;">${vars.note}</p>` : ""}
    </div>
    <p style="text-align:center;">
      <a href="${vars.actionLink}" class="btn">${vars.actionLabel}</a>
    </p>
  `);

  return {
    subject: `${vars.heading}: ${vars.itemTitle}`,
    html,
  };
}
