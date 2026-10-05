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

// Retries spread over about eight hours, so an outage of the mail server for
// minutes or hours delays mail instead of losing it: three tries seconds
// apart used to fail every reset and invitation queued during a short outage
// for good. RETRY_DELAYS_MIN[n - 1] is the wait after the n-th failed try.
const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360];
export const EMAIL_MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
// A claimed row holds its claim this long. A run that dies while sending (a
// deploy's reload, a crash) leaves its rows SENDING; once the claim runs out
// the next run takes them again, while they are still worth sending.
const CLAIM_LEASE_MIN = 15;
// A row still not sent a day after it was queued is closed as FAILED rather
// than sent late: its links (resets, verifications) have long expired.
const GIVE_UP_HOURS = 24;

/** The wait before the next try, after `attempts` failed ones. */
export function emailRetryDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MIN.length) - 1;
  return RETRY_DELAYS_MIN[i] * 60_000;
}

// The columns hold UTC wall time with no zone (how Prisma writes DateTime),
// so raw SQL compares them with UTC "now", never with now() itself, which
// Postgres reads in the session's zone (Asia/Kolkata on a local database:
// every row would look five and a half hours early or late).
const UTC_NOW = `(now() AT TIME ZONE 'UTC')`;

// Rows a run may claim: queued and due, or SENDING with the claim run out.
const CLAIMABLE = `(
  ("status" = 'QUEUED' AND attempts < ${EMAIL_MAX_ATTEMPTS} AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${UTC_NOW}))
  OR ("status" = 'SENDING' AND attempts < ${EMAIL_MAX_ATTEMPTS}
      AND "createdAt" > ${UTC_NOW} - interval '${GIVE_UP_HOURS} hours'
      AND COALESCE("nextAttemptAt", "createdAt" + interval '${CLAIM_LEASE_MIN} minutes') <= ${UTC_NOW})
)`;

let warnedEmailOff = false;

export type EmailQueueResult = {
  sent: number;
  /** Failed this run and queued again, for a later try. */
  retrying: number;
  /** Failed for the last time this run. */
  failed: number;
  /** Production with no mail transport: rows left waiting, none sent. */
  held?: number;
};

export async function processEmailQueue(): Promise<EmailQueueResult> {
  const transporter = getTransporter();
  let sent = 0;
  let retrying = 0;
  let failed = 0;

  // In production with no mail transport (EMAIL_ENABLED is not "true"),
  // nothing is claimed: the rows stay QUEUED with their content, and go out
  // once mail is set up. This used to take the development path below, which
  // logs each email and marks it SENT, so every verification, invitation and
  // reset on a server set up without the variable was recorded as sent and
  // never arrived.
  if (!transporter && !IS_DEV) {
    const held = await prisma.emailLog.count({ where: { status: "QUEUED" } });
    if (held > 0 && !warnedEmailOff) {
      warnedEmailOff = true;
      console.error(`[Email] Mail is off (EMAIL_ENABLED is not "true"): ${held} emails are waiting and none is sent. See scripts/DEPLOY-NOTES.md.`);
    }
    return { sent: 0, retrying: 0, failed: 0, held };
  }

  // Rows a run died on more than a day ago are closed, not sent late.
  const giveUpBefore = new Date(Date.now() - GIVE_UP_HOURS * 3_600_000);
  const interrupted = { status: "SENDING" as const, createdAt: { lt: giveUpBefore } };
  const giveUp = { status: "FAILED" as const, error: "Interrupted while sending, and not sent within a day.", nextAttemptAt: null };
  await prisma.emailLog.updateMany({ where: { ...interrupted, template: { in: [...SECRET_LINK_TEMPLATES] } }, data: { ...giveUp, html: null } });
  await prisma.emailLog.updateMany({ where: { ...interrupted, template: { notIn: [...SECRET_LINK_TEMPLATES] } }, data: giveUp });

  // Claim a batch: due rows become SENDING in one statement, and each row is
  // claimed by one run only. Every sendEmail starts a run, so runs overlap
  // all the time (send-reminders queues hundreds at once). FOR UPDATE SKIP
  // LOCKED makes a second run pass over the rows the first is claiming, and
  // the outer check makes it skip any row that was claimed while it waited;
  // without both, two runs read the same ids and sent each email twice. The
  // claim is a lease (nextAttemptAt), so a row whose run died is taken again.
  // A claimed row can be deleted while it is sent (its company deleted for
  // good, /api/cron/org-hard-delete), so each write after the claim is an
  // updateMany: a row that is gone updates nothing, where update would throw
  // out of the loop and leave the rest of the batch stuck in SENDING.
  const claimed = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE "EmailLog"
    SET status = 'SENDING', attempts = attempts + 1, "nextAttemptAt" = ${UTC_NOW} + interval '${CLAIM_LEASE_MIN} minutes'
    WHERE ${CLAIMABLE} AND id IN (
      SELECT id FROM "EmailLog"
      WHERE ${CLAIMABLE}
      ORDER BY "createdAt" ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  if (claimed.length === 0) return { sent: 0, retrying: 0, failed: 0 };

  const claimedIds = claimed.map((c) => c.id);
  const emails = await prisma.emailLog.findMany({
    where: { id: { in: claimedIds } },
    orderBy: { createdAt: "asc" },
  });

  for (const email of emails) {
    try {
      if (!EMAIL_ENABLED || !transporter) {
        // Development with no mail transport: log instead of sending.
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
          data: closedRowData(email.template, { status: "SENT", sentAt: new Date(), nextAttemptAt: null }),
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
        data: closedRowData(email.template, { status: "SENT", sentAt: new Date(), nextAttemptAt: null }),
      });
      sent++;
    } catch (err: any) {
      console.error(`[Email] Failed to send to ${email.to}:`, err.message);
      if (email.attempts >= EMAIL_MAX_ATTEMPTS) {
        await prisma.emailLog.updateMany({
          where: { id: email.id },
          data: closedRowData(email.template, { status: "FAILED", error: err.message, nextAttemptAt: null }),
        });
        failed++;
      } else {
        await prisma.emailLog.updateMany({
          where: { id: email.id },
          data: { status: "QUEUED", error: err.message, nextAttemptAt: new Date(Date.now() + emailRetryDelayMs(email.attempts)) },
        });
        retrying++;
      }
    }
  }

  return { sent, retrying, failed };
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
