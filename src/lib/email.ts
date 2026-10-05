import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

// ==========================================
// SMTP Transport
// ==========================================

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const IS_DEV = process.env.NODE_ENV !== "production";

function getTransporter() {
  if (!EMAIL_ENABLED) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM_ADDRESS = process.env.SMTP_FROM || "WorkwrK <noreply@workwrk.com>";

// ==========================================
// Preference Types
// ==========================================

export type EmailCategory = "kra" | "review" | "sop" | "policy" | "agreement" | "kudos" | "invitation" | "reminder" | "verify" | "survey";

const CATEGORY_TO_PREF: Record<string, string> = {
  kra: "kraNotifications",
  review: "reviewNotifications",
  sop: "sopNotifications",
  kudos: "kudosNotifications",
};

// ==========================================
// Check user email preference
// ==========================================

async function shouldSendEmail(userId: string, category: EmailCategory): Promise<boolean> {
  // Always send invitations and reminders
  if (category === "invitation" || category === "reminder") return true;

  const prefField = CATEGORY_TO_PREF[category];
  if (!prefField) return true;

  try {
    const pref = await prisma.emailPreference.findUnique({
      where: { userId },
    });
    // No preference record = defaults (all on)
    if (!pref) return true;
    return (pref as any)[prefField] === true;
  } catch {
    return true; // Default to sending if check fails
  }
}

// ==========================================
// Secrets at rest
// ==========================================

/**
 * Templates whose body carries a working secret link: a password reset, an
 * email verification, an invitation, a signing request. Reset and verify
 * tokens are hashed in their own tables so a database leak yields no working
 * link; the EmailLog row must not undo that. So for these templates the
 * link-bearing variables are never stored, and the rendered HTML (which is
 * needed to send) is cleared the moment the row is SENT or finally FAILED.
 * The subject, recipient, template and timestamps stay as the delivery log.
 */
export const SECRET_LINK_TEMPLATES: ReadonlySet<string> = new Set([
  "password-reset",
  "verify-email",
  "invitation",
  "invitation-space",
  "invitation-space-resend",
  "document-sign",
]);

const SECRET_VARIABLE_KEY = /link|url|token|href/i;

/** Variables as stored: a secret template never keeps a link, url or token value. */
export function storedEmailVariables(template: string, variables: Record<string, unknown> | undefined): Record<string, unknown> {
  const vars = variables || {};
  if (!SECRET_LINK_TEMPLATES.has(template)) return vars;
  return Object.fromEntries(Object.entries(vars).filter(([k]) => !SECRET_VARIABLE_KEY.test(k)));
}

/** The update that closes a row: a secret template's HTML is cleared with it. */
function closedRowData<T extends object>(template: string, data: T): T & { html?: null } {
  return SECRET_LINK_TEMPLATES.has(template) ? { ...data, html: null } : data;
}

// ==========================================
// Queue email (write to EmailLog table)
// ==========================================

interface QueueEmailParams {
  to: string;
  subject: string;
  html: string;
  template: string;
  variables?: Record<string, any>;
  organizationId?: string;
  userId?: string;
  category?: EmailCategory;
}

/**
 * The EmailLog row queueEmail writes, for a caller that must queue inside
 * its OWN transaction (the scheduled-report cron claims a run and queues its
 * emails atomically, so a retried cron can never queue the same run twice).
 * The row is exactly what queueEmail would write; processEmailQueue (the
 * email-queue cron) sends it like any other.
 */
export function emailLogData(p: {
  to: string;
  subject: string;
  html: string;
  template: string;
  variables?: Record<string, unknown>;
  organizationId?: string;
}) {
  return {
    to: p.to,
    subject: p.subject,
    template: p.template,
    html: p.html,
    variables: storedEmailVariables(p.template, p.variables) as object,
    organizationId: p.organizationId,
    status: "QUEUED" as const,
  };
}

export async function queueEmail({
  to,
  subject,
  html,
  template,
  variables,
  organizationId,
  userId,
  category,
}: QueueEmailParams): Promise<void> {
  // Check preferences if userId and category provided
  if (userId && category) {
    const allowed = await shouldSendEmail(userId, category);
    if (!allowed) {
      if (IS_DEV) console.log(`[Email] Skipped (preference off): ${template} → ${to}`);
      return;
    }
  }

  try {
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        template,
        html,
        variables: storedEmailVariables(template, variables) as object,
        organizationId,
        status: "QUEUED",
      },
    });

    if (IS_DEV && !EMAIL_ENABLED) {
      console.log(`[Email Queued] To: ${to} | Subject: ${subject} | Template: ${template}`);
    }
  } catch (err) {
    console.error("[Email] Failed to queue email:", err);
  }
}

// ==========================================
// Process email queue (send queued emails)
// ==========================================

export async function processEmailQueue(): Promise<{ sent: number; failed: number }> {
  const transporter = getTransporter();
  let sent = 0;
  let failed = 0;

  // Claim a batch: QUEUED becomes SENDING in one statement, and each row is
  // claimed by one run only. Every sendEmail starts a run, so runs overlap
  // all the time (send-reminders queues hundreds at once). FOR UPDATE SKIP
  // LOCKED makes a second run pass over the rows the first is claiming, and
  // the outer status check makes it skip any row that was claimed while it
  // waited; without both, two runs read the same ids and sent each email
  // twice.
  // A claimed row can be deleted while it is sent (its company deleted for
  // good, /api/cron/org-hard-delete), so each write after the claim is an
  // updateMany: a row that is gone updates nothing, where update would throw
  // out of the loop and leave the rest of the batch stuck in SENDING.
  const claimed = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE "EmailLog"
    SET status = 'SENDING', attempts = attempts + 1
    WHERE status = 'QUEUED' AND id IN (
      SELECT id FROM "EmailLog"
      WHERE status = 'QUEUED' AND attempts < 3
      ORDER BY "createdAt" ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const claimedIds = claimed.map((c) => c.id);
  const emails = await prisma.emailLog.findMany({
    where: { id: { in: claimedIds } },
    orderBy: { createdAt: "asc" },
  });

  for (const email of emails) {
    try {
      if (!EMAIL_ENABLED || !transporter) {
        // Dev mode: log to console instead of sending
        console.log(`\n========== EMAIL (dev) ==========`);
        console.log(`To: ${email.to}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Template: ${email.template}`);
        // Local testing still needs the link once the stored copy is
        // cleared, so a dev run with no mail transport prints it here.
        if (IS_DEV && SECRET_LINK_TEMPLATES.has(email.template) && email.html) {
          for (const m of email.html.matchAll(/href="([^"]+)"/g)) console.log(`Link: ${m[1]}`);
        }
        console.log(`================================\n`);

        await prisma.emailLog.updateMany({
          where: { id: email.id },
          data: closedRowData(email.template, { status: "SENT", sentAt: new Date() }),
        });
        sent++;
        continue;
      }

      await transporter.sendMail({
        from: FROM_ADDRESS,
        to: email.to,
        subject: email.subject,
        html: email.html || renderFromLog(email),
      });

      await prisma.emailLog.updateMany({
        where: { id: email.id },
        data: closedRowData(email.template, { status: "SENT", sentAt: new Date() }),
      });
      sent++;
    } catch (err: any) {
      console.error(`[Email] Failed to send to ${email.to}:`, err.message);
      const newStatus = email.attempts >= 3 ? "FAILED" : "QUEUED";
      await prisma.emailLog.updateMany({
        where: { id: email.id },
        data: newStatus === "FAILED" ? closedRowData(email.template, { status: newStatus, error: err.message }) : { status: newStatus, error: err.message },
      });
      failed++;
    }
  }

  return { sent, failed };
}

// Re-render template from stored log variables
function renderFromLog(email: { template: string; variables: any }): string {
  // We store the rendered HTML via the queue function, but for retry
  // we need to re-render. For simplicity, we store a minimal indicator.
  // The actual HTML is generated at queue time and we rely on the template+variables.
  // For now, return a simple fallback.
  const vars = email.variables as Record<string, string>;
  return Object.entries(vars).reduce(
    (html, [key, val]) => html.replace(new RegExp(`\\{${key}\\}`, "g"), String(val)),
    `<p>${email.template}: ${JSON.stringify(vars)}</p>`
  );
}

// ==========================================
// Convenience: queue + immediate send attempt
// ==========================================

export async function sendEmail(params: QueueEmailParams): Promise<void> {
  // Queue synchronously (fast — just a DB insert)
  await queueEmail(params);

  // Process the queue in background — this is safe in a long-running Node
  // server because the event loop keeps the promise alive after the response
  // returns. Errors are caught and logged so we never throw to the request.
  processEmailQueue().catch((err) => {
    console.error("[Email] Background queue processing failed:", err);
  });
}

// ==========================================
// Get/update email preferences
// ==========================================

/**
 * What a person with no EmailPreference row is shown. It must say exactly
 * what shouldSendEmail does for them (no row = every category sends) and
 * what the schema creates on their first change (every category true,
 * digest false). The KRA key was once `taskNotifications`, a field that does
 * not exist: the page read the missing `kraNotifications` as Off while KPI
 * reminders kept going out, and the switch then flipped On by itself the
 * moment any other category was saved and the row was created.
 */
export const EMAIL_PREFERENCE_DEFAULTS = {
  kraNotifications: true,
  reviewNotifications: true,
  sopNotifications: true,
  kudosNotifications: true,
  dailyDigest: false,
} as const;

export async function getEmailPreferences(userId: string) {
  const pref = await prisma.emailPreference.findUnique({ where: { userId } });
  if (pref) return pref;

  return { ...EMAIL_PREFERENCE_DEFAULTS };
}

export async function updateEmailPreferences(
  userId: string,
  data: {
    kraNotifications?: boolean;
    reviewNotifications?: boolean;
    sopNotifications?: boolean;
    kudosNotifications?: boolean;
    dailyDigest?: boolean;
  }
) {
  return prisma.emailPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
