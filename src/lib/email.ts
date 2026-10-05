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
    // A login only when both are set: a relay that needs none (and still
    // offers AUTH) failed every send when nodemailer tried empty ones.
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    // A mail server that stops answering fails a send in seconds, well
    // inside the claim's lease (processEmailQueue): nodemailer's own
    // defaults (two minutes to connect, ten of silence) let a batch outlast
    // its lease, and a second run then sent the same emails again.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

const FROM_ADDRESS = process.env.SMTP_FROM || "WorkwrK <noreply@workwrk.com>";
// Where a reply to any email goes. The From address is a no-reply one, while
// the welcome email says "Reply to this email": without a Reply-To a new
// customer's first question went to a mailbox nobody reads. The default is
// the site's general mailbox (src/components/marketing/config.ts mailboxes).
const REPLY_TO = process.env.EMAIL_REPLY_TO?.trim() || "hello@workwrk.com";

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

// No email goes to a workspace that is suspended or cancelled: its people
// cannot sign in, and a cancelled one is being deleted. Every mailer (the
// reminder digests, KPI and OKR reminders, announcements, reviews, reports)
// queues through here, and none of them used to check, so a closed company's
// people kept getting the monthly emails. A workspace that no longer exists
// gets none either. Read once a minute per workspace, not once per email; a
// failed read lets the email through, so a database blip never drops mail.
const ORG_STATUS_TTL_MS = 60_000;
const orgTakesMail = new Map<string, { ok: boolean; at: number }>();

async function workspaceTakesEmail(organizationId: string): Promise<boolean> {
  const hit = orgTakesMail.get(organizationId);
  if (hit && Date.now() - hit.at < ORG_STATUS_TTL_MS) return hit.ok;
  let ok = true;
  try {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
    ok = !!org && org.status !== "SUSPENDED" && org.status !== "CANCELLED";
  } catch {
    return true;
  }
  if (orgTakesMail.size > 5000) orgTakesMail.clear();
  orgTakesMail.set(organizationId, { ok, at: Date.now() });
  return ok;
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
  if (organizationId && !(await workspaceTakesEmail(organizationId))) {
    if (IS_DEV) console.log(`[Email] Skipped (workspace suspended, cancelled or gone): ${template} → ${to}`);
    return;
  }
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
// the next run takes them again, however old the row is (a backlog held
// while mail was off is sent the day it comes on, and a reload mid-flush
// must not lose it), until its last try. A row interrupted on its last try,
// and a row left SENDING more than a day ago from before claims had a lease
// (no nextAttemptAt), are closed as FAILED instead.
const CLAIM_LEASE_MIN = 15;
const LEGACY_SENDING_HOURS = 24;

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
  OR ("status" = 'SENDING' AND attempts < ${EMAIL_MAX_ATTEMPTS} AND (
        ("nextAttemptAt" IS NOT NULL AND "nextAttemptAt" <= ${UTC_NOW})
        OR ("nextAttemptAt" IS NULL AND "createdAt" + interval '${CLAIM_LEASE_MIN} minutes' <= ${UTC_NOW}
            AND "createdAt" > ${UTC_NOW} - interval '${LEGACY_SENDING_HOURS} hours')))
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

  // Rows nothing will take again are closed (the claim's rules above): ones
  // interrupted on their last try, once that claim has run out (a live run
  // sending a row right now is never touched), and ones left SENDING more
  // than a day ago from before claims had a lease.
  const legacyBefore = new Date(Date.now() - LEGACY_SENDING_HOURS * 3_600_000);
  const interrupted = {
    status: "SENDING" as const,
    OR: [
      { attempts: { gte: EMAIL_MAX_ATTEMPTS }, nextAttemptAt: { lt: new Date() } },
      { nextAttemptAt: null, createdAt: { lt: legacyBefore } },
    ],
  };
  const giveUp = { status: "FAILED" as const, error: "Interrupted while sending, and not taken again.", nextAttemptAt: null };
  await prisma.emailLog.updateMany({ where: { ...interrupted, template: { in: [...SECRET_LINK_TEMPLATES] } }, data: { ...giveUp, html: null } });
  await prisma.emailLog.updateMany({ where: { ...interrupted, template: { notIn: [...SECRET_LINK_TEMPLATES] } }, data: giveUp });

  // Claim a batch: due rows become SENDING in one statement, and each row is
  // claimed by one run only. Every sendEmail starts a run, so runs overlap
  // all the time (send-reminders queues hundreds at once). FOR UPDATE SKIP
  // LOCKED makes a second run pass over the rows the first is claiming, and
  // the outer check makes it skip any row that was claimed while it waited;
  // without both, two runs read the same ids and sent each email twice.
  //
  // The claim is a LEASE (nextAttemptAt), so a row whose run died is taken
  // again, and its attempts count is the claim's token: every claim adds one.
  // Before each send the run renews the lease on that row, but only while
  // the row is still SENDING with ITS attempts; if another run took it after
  // a lease ran out, this run skips it. Every write after the claim carries
  // the same condition, so a run never overwrites what another run recorded
  // (a SENT turned back to QUEUED and sent again). A run sends twice only if
  // one send outlasts the renewed lease, which the transport's timeouts
  // rule out.
  //
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
    // This run's hold on the row: SENDING with the attempts its claim set.
    const ours = { id: email.id, status: "SENDING" as const, attempts: email.attempts };
    try {
      const renewed = await prisma.$executeRawUnsafe(
        `UPDATE "EmailLog" SET "nextAttemptAt" = ${UTC_NOW} + interval '${CLAIM_LEASE_MIN} minutes'
         WHERE id = $1 AND status = 'SENDING' AND attempts = $2`,
        email.id,
        email.attempts,
      );
      // Another run holds it now, or it was closed or deleted: not ours to send.
      if (renewed !== 1) continue;
      // A secret-link email whose stored content is gone cannot be sent
      // again: what renderFromLog builds is no email, and its link is gone.
      if (!email.html && SECRET_LINK_TEMPLATES.has(email.template)) {
        await prisma.emailLog.updateMany({
          where: ours,
          data: closedRowData(email.template, { status: "FAILED", error: "Its content was cleared before it could be sent.", nextAttemptAt: null }),
        });
        failed++;
        continue;
      }
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
          where: ours,
          data: closedRowData(email.template, { status: "SENT", sentAt: new Date(), nextAttemptAt: null }),
        });
        sent++;
        continue;
      }

      await transporter.sendMail({
        from: FROM_ADDRESS,
        replyTo: REPLY_TO,
        to: email.to,
        subject: email.subject,
        html: email.html || renderFromLog(email),
      });

      await prisma.emailLog.updateMany({
        where: ours,
        data: closedRowData(email.template, { status: "SENT", sentAt: new Date(), nextAttemptAt: null }),
      });
      sent++;
    } catch (err: any) {
      console.error(`[Email] Failed to send to ${email.to}:`, err.message);
      if (email.attempts >= EMAIL_MAX_ATTEMPTS) {
        await prisma.emailLog.updateMany({
          where: ours,
          data: closedRowData(email.template, { status: "FAILED", error: err.message, nextAttemptAt: null }),
        });
        failed++;
      } else {
        await prisma.emailLog.updateMany({
          where: ours,
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
