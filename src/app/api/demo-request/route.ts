// The demo request endpoint.
//
// /demo is the site-wide secondary CTA: the nav renders "Book a demo" on
// every page, so this is the second most walked path on the marketing site.
// Its form used to be `<form action="#" method="post">` with no handler,
// which meant every submission was discarded, silently, after the visitor
// had typed their name, their work email and what they wanted to see. A
// control with no handler is a lie, and this one was told at the exact
// moment a stranger decided to trust us.
//
// What this does and, just as importantly, does not do:
//
//   * NO DATABASE. It writes no row and imports no prisma client. A demo
//     request is a message to a person, and the CRM for it is an inbox.
//   * It emails the sales address over SMTP, directly, using the transport
//     config the rest of the app already uses.
//   * When SMTP is not configured it says so, with a 503 and a machine
//     readable reason, and the form falls back to a mailto: link that
//     carries the same content. It NEVER reports success for a message
//     nobody received. That is the entire reason this file exists.
//
// Rate limiting is per IP, in memory. It is not a distributed limiter and
// does not pretend to be: it stops a bored person with a loop, and the SMTP
// provider stops the rest.

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FIELD = 2000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map from growing without bound on a long-lived server.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD) : "";
}

/** Good enough to catch a typo, deliberately not an RFC 5322 parser. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DemoRequestBody {
  name?: string;
  email?: string;
  company?: string;
  size?: string;
  industry?: string;
  notes?: string;
  /** Honeypot. A human never fills this in, because it is not rendered. */
  website?: string;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: "Too many requests. Try again in an hour." },
      { status: 429 },
    );
  }

  let body: DemoRequestBody;
  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request", message: "Could not read the form." }, { status: 400 });
  }

  // A bot filled the hidden field. Accept it so it stops retrying, and send
  // nothing. This is the one place the endpoint answers 200 without an email,
  // and the sender is not a person.
  if (clean(body.website)) return NextResponse.json({ ok: true });

  const name = clean(body.name);
  const email = clean(body.email);
  const company = clean(body.company);
  const size = clean(body.size);
  const industry = clean(body.industry);
  const notes = clean(body.notes);

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!company) missing.push("company");
  if (email && !looksLikeEmail(email)) missing.push("email");

  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, reason: "invalid", fields: missing, message: "Check the highlighted fields." },
      { status: 422 },
    );
  }

  const to = process.env.DEMO_REQUEST_TO || process.env.SALES_EMAIL || "";
  const host = process.env.SMTP_HOST;
  const configured = process.env.EMAIL_ENABLED === "true" && Boolean(host) && Boolean(to);

  if (!configured) {
    // Loud on the server, honest to the visitor. The form shows the mailto
    // fallback rather than a confirmation nobody earned.
    console.error(
      "[demo-request] Not configured. Set EMAIL_ENABLED=true, SMTP_HOST and DEMO_REQUEST_TO. " +
        `Dropped a request from ${email} at ${company}.`,
    );
    return NextResponse.json(
      { ok: false, reason: "not_configured", message: "The form could not send. Email us instead." },
      { status: 503 },
    );
  }

  const rows: Array<[string, string]> = [
    ["Name", name],
    ["Work email", email],
    ["Company", company],
    ["Team size", size || "not given"],
    ["Industry", industry || "not given"],
    ["Wants to see", notes || "not given"],
  ];

  try {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });

    await transport.sendMail({
      to,
      from: process.env.SMTP_FROM || "WorkwrK <noreply@workwrk.com>",
      replyTo: email,
      subject: `Demo request: ${company}`,
      text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
      html:
        "<table style=\"font-family:system-ui,sans-serif;font-size:14px\">" +
        rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#5C6779">${k}</td>` +
              `<td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
          )
          .join("") +
        "</table>",
    });
  } catch (error) {
    console.error("[demo-request] SMTP send failed:", error);
    return NextResponse.json(
      { ok: false, reason: "send_failed", message: "The form could not send. Email us instead." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
