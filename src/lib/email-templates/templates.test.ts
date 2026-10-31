import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invitationTemplate, passwordResetTemplate, personalReminderTemplate, reminderTemplate, verifyEmailTemplate, welcomeTemplate } from "./index";
import { escapeHtml, safeHref } from "./escape";

const DIR = join(process.cwd(), "src/lib/email-templates");

describe("email templates", () => {
  it("carry no dark ground, no lime and no em dash in any template file", () => {
    for (const f of readdirSync(DIR).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(join(DIR, f), "utf8").toLowerCase();
      for (const banned of ["#0a0a0a", "#141414", "#1a1a1a", "#1f1f1f", "#d4ff2e", "#e2ff6b", "#fafafa", "outfit"]) {
        expect(src.includes(banned), `${f} contains ${banned}`).toBe(false);
      }
      expect(src.includes("—"), `${f} contains an em dash`).toBe(false);
    }
  });

  it("escape every name and message a person typed", () => {
    const w = welcomeTemplate({ firstName: "<img src=x>", organizationName: "A&B <Co>", loginLink: "https://app.example/home" });
    expect(w.html).not.toContain("<img src=x>");
    expect(w.html).toContain("&lt;img src=x&gt;");
    expect(w.html).toContain("A&amp;B &lt;Co&gt;");
    const r = passwordResetTemplate({ firstName: "<b>x</b>", resetLink: "https://app.example/reset-password?token=t" });
    expect(r.html).not.toContain("<b>x</b>");
    const i = invitationTemplate({ companyName: "<Co>", inviteLink: "https://app.example/join?token=t", role: "EMPLOYEE", personalMessage: "<script>" });
    expect(i.html).not.toContain("<script>");
    expect(i.html).not.toContain("<Co>");
  });

  it("speaks the four-role words, never a raw level", () => {
    expect(invitationTemplate({ companyName: "Co", inviteLink: "https://a/join?token=t", role: "COMPANY_ADMIN" }).html).toContain("<strong>Admin</strong>");
    const m = invitationTemplate({ companyName: "Co", inviteLink: "https://a/join?token=t", role: "TEAM_LEAD" }).html;
    expect(m).toContain("<strong>Member</strong>");
    expect(m).not.toContain("TEAM");
  });

  it("put every CTA on a real link and nothing unsafe in an href", () => {
    expect(invitationTemplate({ companyName: "Co", inviteLink: "https://a/join?token=t", role: "EMPLOYEE" }).html).toContain('href="https://a/join?token=t"');
    expect(verifyEmailTemplate({ firstName: "P", verifyUrl: "https://a/verify-email?token=t" }).html).toContain('href="https://a/verify-email?token=t"');
    expect(reminderTemplate({ itemType: "Task", itemTitle: "T", dueInfo: "tomorrow", itemLink: "javascript:alert(1)" }).html).toContain('href="#"');
    expect(safeHref("https://a/b?c=1&d=2")).toBe("https://a/b?c=1&amp;d=2");
    expect(escapeHtml(null)).toBe("");
  });

  it("drop the stale nav copy from the welcome email", () => {
    const w = welcomeTemplate({ firstName: "P", organizationName: "Co", loginLink: "https://a/home", isCreator: true }).html;
    expect(w).not.toContain("Organization");
    expect(w).not.toContain("Settings &rarr; Team");
    expect(w).toContain("Workspace settings &gt; Members");
  });

  it("sends the personal reminder in the branded layout, escaped, with an absolute button", () => {
    const r = personalReminderTemplate({ title: "<b>Call Ana</b>", body: "Bring the <deck>", link: "https://app.example/home", openLabel: "Open WorkwrK" });
    expect(r.subject).toBe("Reminder: <b>Call Ana</b>");
    expect(r.html).toContain("&lt;b&gt;Call Ana&lt;/b&gt;");
    expect(r.html).toContain("Bring the &lt;deck&gt;");
    expect(r.html).toContain('href="https://app.example/home"');
    expect(personalReminderTemplate({ title: "T", link: "/home", openLabel: "Open" }).html).toContain('href="#"');
  });
});

// Sent on 1 November about October: it used to read "It's the 1st of October
// 2026" on 1 November, and both monthly emails linked to /kra-kpi, a page that
// only holds the definitions (launch audit, 2026-10-31).
describe("the monthly evaluation and KPI emails", () => {
  it("name the month being evaluated without claiming today is its 1st", async () => {
    const { evaluationReminderTemplate } = await import("./evaluation-reminder");
    const { html, subject } = evaluationReminderTemplate({ managerName: "Mia", teamMembers: ["Max Low"], month: "October 2026", evaluationLink: "https://app.workwrk.com/team/kpi-reviews" });
    expect(html).not.toMatch(/1st of/);
    expect(html).toContain("October 2026");
    expect(subject).toContain("October 2026");
  });

  it("link to where the work is done: the approval queue, and the person's KRAs tab", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/email/send-reminders/route.ts"), "utf8");
    expect(src).toContain("evaluationLink: `${baseUrl}/team/kpi-reviews`");
    expect(src).toContain("itemLink: `${baseUrl}/people/me?tab=kras`");
    expect(src).not.toMatch(/\$\{baseUrl\}\/kra-kpi/);
  });
});
