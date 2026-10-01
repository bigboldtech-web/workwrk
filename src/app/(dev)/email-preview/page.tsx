// /email-preview: a local eyeball of the rebuilt email templates
// (spec-account-auth A2). Renders only when NODE_ENV is not "production"
// and is the 404 otherwise, like /loader-preview. Sample values only; no
// email is sent from here. ?t=<name> renders one template full width (for
// the screenshot harness); no parameter renders them all side by side.
import { notFound } from "next/navigation";
import {
  invitationTemplate,
  passwordResetTemplate,
  reminderTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from "@/lib/email-templates";

export const dynamic = "force-dynamic";

const BASE = "https://app.workwrk.com";

function samples(): Record<string, { subject: string; html: string }> {
  return {
    welcome: welcomeTemplate({ firstName: "Priya", organizationName: "Northwind Ops", loginLink: `${BASE}/home`, isCreator: true }),
    "welcome-member": welcomeTemplate({ firstName: "Sam", organizationName: "Northwind Ops", loginLink: `${BASE}/spaces/general` }),
    invitation: invitationTemplate({
      companyName: "Northwind Ops",
      inviteLink: `${BASE}/join?token=sample`,
      role: "EMPLOYEE",
      inviterName: "Priya Sharma",
      personalMessage: "Welcome aboard! Your first project is the Q4 launch.",
    }),
    verification: verifyEmailTemplate({ firstName: "Priya", verifyUrl: `${BASE}/verify-email?token=sample` }),
    reset: passwordResetTemplate({ firstName: "Priya", resetLink: `${BASE}/reset-password?token=sample` }),
    reminder: reminderTemplate({ itemType: "Task", itemTitle: "Send the Q4 launch brief", dueInfo: "due tomorrow", itemLink: `${BASE}/item/sample` }),
  };
}

export default async function EmailPreviewPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { t } = await searchParams;
  const all = samples();
  if (t && all[t]) {
    return <iframe title={all[t].subject} srcDoc={all[t].html} style={{ border: 0, width: "100%", height: "100vh", display: "block" }} />;
  }
  return (
    <main style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 24, padding: 24, background: "#FFFFFF", minHeight: "100vh" }}>
      {Object.entries(all).map(([key, e]) => (
        <section key={key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>
            {key}: {e.subject}
          </strong>
          <iframe title={key} srcDoc={e.html} style={{ border: "1px solid #E4E7EC", borderRadius: 8, width: "100%", height: 640 }} />
        </section>
      ))}
    </main>
  );
}
