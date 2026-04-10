import { baseLayout } from "./base";

interface OverdueManagerVars {
  managerName: string;
  items: { type: string; title: string; personName: string; daysOverdue: number }[];
  dashboardLink: string;
}

export function overdueManagerTemplate(vars: OverdueManagerVars): { subject: string; html: string } {
  const rows = vars.items.map((item) =>
    `<tr style="border-bottom:1px solid #2A2A3A;">
      <td style="padding:8px 0;font-size:13px;color:#E8E8F0;">${item.personName}</td>
      <td style="padding:8px 0;font-size:13px;color:#8888A0;">${item.type}</td>
      <td style="padding:8px 0;font-size:13px;color:#8888A0;">${item.title}</td>
      <td style="padding:8px 0;font-size:13px;color:#FF6B6B;text-align:right;">${item.daysOverdue}d overdue</td>
    </tr>`
  ).join("");

  const html = baseLayout(`
    <h1>Overdue Items — Your Team</h1>
    <p>Hi ${vars.managerName}, the following items from your team are overdue:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="border-bottom:1px solid #2A2A3A;">
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#6B6B80;text-transform:uppercase;">Person</th>
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#6B6B80;text-transform:uppercase;">Type</th>
          <th style="text-align:left;padding:6px 0;font-size:11px;color:#6B6B80;text-transform:uppercase;">Item</th>
          <th style="text-align:right;padding:6px 0;font-size:11px;color:#6B6B80;text-transform:uppercase;">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <hr class="divider" />
    <p style="text-align:center;">
      <a href="${vars.dashboardLink}" class="btn">View Dashboard</a>
    </p>
    <p class="meta">This is an automated weekly check. Follow up with your team to get these resolved.</p>
  `);

  return {
    subject: `${vars.items.length} overdue item${vars.items.length !== 1 ? "s" : ""} from your team`,
    html,
  };
}
