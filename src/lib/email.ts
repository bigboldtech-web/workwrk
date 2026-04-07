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

export type EmailCategory = "kra" | "review" | "sop" | "kudos" | "invitation" | "reminder";

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
        variables: variables || {},
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

  // Fetch up to 20 queued emails
  const queued = await prisma.emailLog.findMany({
    where: {
      status: "QUEUED",
      attempts: { lt: 3 }, // Max 3 attempts
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  if (queued.length === 0) return { sent: 0, failed: 0 };

  for (const email of queued) {
    // Mark as sending
    await prisma.emailLog.update({
      where: { id: email.id },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });

    try {
      if (!EMAIL_ENABLED || !transporter) {
        // Dev mode: log to console instead of sending
        console.log(`\n========== EMAIL (dev) ==========`);
        console.log(`To: ${email.to}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Template: ${email.template}`);
        console.log(`================================\n`);

        await prisma.emailLog.update({
          where: { id: email.id },
          data: { status: "SENT", sentAt: new Date() },
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

      await prisma.emailLog.update({
        where: { id: email.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      sent++;
    } catch (err: any) {
      console.error(`[Email] Failed to send to ${email.to}:`, err.message);
      const newStatus = email.attempts + 1 >= 3 ? "FAILED" : "QUEUED";
      await prisma.emailLog.update({
        where: { id: email.id },
        data: { status: newStatus, error: err.message },
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

export async function getEmailPreferences(userId: string) {
  const pref = await prisma.emailPreference.findUnique({ where: { userId } });
  if (pref) return pref;

  // Return defaults
  return {
    taskNotifications: true,
    reviewNotifications: true,
    sopNotifications: true,
    kudosNotifications: true,
    dailyDigest: false,
  };
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
