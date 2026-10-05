import { baseLayout } from "./base";
import { escapeHtml } from "./escape";

interface OverdueManagerVars {
  managerName: string;
  /** The lines shown, oldest first: at most the digest's cap. */
  items: { type: string; title: string; personName: string; daysOverdue: number }[];
  /** Every overdue item of the team, when more than the lines shown. Defaults to items.length. */
  total?: number;
  dashboardLink: string;
}

export function overdueManagerTemplate(vars: OverdueManagerVars): { subject: string; html: string } {
  const total = Math.max(vars.total ?? vars.items.length, vars.items.length);
  // People's own words (titles, names) are escaped: they reach an inbox, not a page.
  const rows = vars.items.map((item) =>
    `<tr style="border-bottom:1px solid #E4E7EC;">
      <td style="padding:8px 0;font-size:13px;color:#1F2430;">${escapeHtml(item.personName)}</td>
      <td style="padding:8px 0;font-size:13px;color:#5C6779;">${escapeHtml(item.type)}</td>
      <td style="padding:8px 0;font-size:13px;color:#5C6779;">${escapeHtml(item.title)}</td>
      <td style="padding:8px 0;font-size:13px;color:#B42318;text-align:right;">${item.daysOverdue}d overdue</td>
    </tr>`
  ).join("");
  // A cut list says so: "the following items" over the 50 oldest read as
  // the whole team's work when there were more.
  const more = total > vars.items.length
    ? `<p class="meta">Showing the ${vars.items.length} oldest of ${total}.</p>`
    : "";

  const html = baseLayout(`
    <h1>Overdue items: your team</h1>
    <p>Hi ${escapeHtml(vars.managerName)}, ${total > vars.items.length ? `${total} items from your team are overdue. The oldest:` : "the following items from your team are overdue:"}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="border-bottom:1px solid #E4E7EC;">
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#667085;text-transform:uppercase;">Person</th>
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#667085;text-transform:uppercase;">Type</th>
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#667085;text-transform:uppercase;">Item</th>
          <th style="text-align:right;padding:6px 0;font-size:11px;color:#667085;text-transform:uppercase;">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${more}
    <hr class="divider" />
    <p style="text-align:center;">
      <a href="${vars.dashboardLink}" class="btn">View Dashboard</a>
    </p>
    <p class="meta">This is an automated weekly check. Follow up with your team to get these resolved.</p>
  `);

  return {
    subject: `${total} overdue item${total !== 1 ? "s" : ""} from your team`,
    html,
  };
}
