// The appraisal letter as a self-contained HTML page: the preview in the
// 720 modal and the "Download" file are the same document, so what a person
// reads is exactly what they save or print.

import type { AppraisalLetter } from "./cycle-types";
import { outcomeLabel, cycleTypeLabel } from "@/lib/performance/review-cycle";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function day(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function buildLetterHtml(l: AppraisalLetter): string {
  const kraRows = (l.kraRatings ?? [])
    .map((k) => `<tr><td>${esc(k.kraName || "")}</td><td style="text-align:center">${k.rating != null ? `${esc(k.rating)} of 5` : ""}</td><td>${esc(k.comments || "")}</td></tr>`)
    .join("");
  const behavioral = Object.entries(l.behavioralRatings ?? {})
    .map(([k, v]) => `<li>${esc(k.charAt(0).toUpperCase() + k.slice(1))}: <strong>${esc(v)} of 5</strong></li>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Appraisal letter, ${esc(l.employeeName)}</title>
<style>body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.55}
h1{font-size:20px;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin:24px 0 8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px}
.muted{color:#6B7280;font-size:13px}.score{font-size:28px;font-weight:600}.band{display:inline-block;padding:2px 10px;border-radius:6px;border:1px solid #E5E7EB;background:#F9FAFB;font-weight:500;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border:1px solid #E5E7EB;padding:6px 8px;text-align:left}th{background:#F9FAFB}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:13px}</style></head><body>
<h1>${esc(l.companyName)}</h1><p class="muted">Appraisal letter · ${esc(l.cycleName)}</p>
<h2>Employee</h2>
<div class="grid"><div><strong>${esc(l.employeeName)}</strong></div><div>${esc(l.role || "")}</div>
<div class="muted">${esc(l.department || "")}</div><div class="muted">${esc(l.employeeEmail || "")}</div>
<div class="muted">${l.joinDate ? `Joined ${esc(day(l.joinDate))}` : ""}</div><div class="muted">${l.reviewerName ? `Reviewer: ${esc(l.reviewerName)}` : ""}</div></div>
<h2>Review period</h2><p class="muted">${esc(day(l.periodStart))} to ${esc(day(l.periodEnd))} · ${esc(cycleTypeLabel(l.cycleType))}</p>
<h2>Overall result</h2><p><span class="score">${esc(Math.round(l.overallScore))}</span> &nbsp; ${l.performanceBand ? `<span class="band">${esc(l.performanceBand)}</span>` : ""}</p>
<p class="muted">Recommended increment: <strong>${esc(l.hikeRecommendation?.label || "")}</strong>${l.outcome ? ` · Outcome: ${esc(outcomeLabel(l.outcome))}` : ""}</p>
${kraRows ? `<h2>KRA ratings</h2><table><thead><tr><th>KRA</th><th>Rating</th><th>Comments</th></tr></thead><tbody>${kraRows}</tbody></table>` : ""}
${behavioral ? `<h2>Behaviours</h2><ul>${behavioral}</ul>` : ""}
${l.managerComments ? `<h2>Manager comments</h2><p>${esc(l.managerComments)}</p>` : ""}
<p class="muted" style="margin-top:32px">Generated ${esc(day(l.generatedAt))}</p>
</body></html>`;
}

export function downloadLetter(l: AppraisalLetter) {
  const blob = new Blob([buildLetterHtml(l)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `appraisal-${l.employeeName.replace(/\s+/g, "-").toLowerCase()}-${l.cycleName.replace(/\s+/g, "-").toLowerCase()}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
