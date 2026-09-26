// The Webhook connection (spec-ai-automation /automation/connections): the
// one connector automations can send to today. Everything lives in the
// existing IntegrationConnection.metadataJson, so there is no migration:
//
//   { url, secret, secretCreatedAt, lastDeliveryAt, lastDeliveryStatus }
//
// The signing secret is returned to the browser exactly once (on first
// connect and on rotate) and never again; every read goes through
// publicWebhookMeta, which drops it.
//
// Each delivery is a POST of JSON with three headers a receiver can check:
//   X-Workwrk-Delivery   a unique id (dedupe on it)
//   X-Workwrk-Timestamp  unix seconds
//   X-Workwrk-Signature  sha256=<hex HMAC of "<timestamp>.<body>" with the secret>

import { createHmac, randomBytes, randomUUID } from "node:crypto";

export interface WebhookMeta {
  url: string | null;
  secret: string | null;
  secretCreatedAt: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function readWebhookMeta(metadataJson: unknown): WebhookMeta {
  const m = asRecord(metadataJson);
  return {
    url: str(m.url),
    secret: str(m.secret),
    secretCreatedAt: str(m.secretCreatedAt),
    lastDeliveryAt: str(m.lastDeliveryAt),
    lastDeliveryStatus: typeof m.lastDeliveryStatus === "number" ? m.lastDeliveryStatus : null,
  };
}

/** What a browser may see: never the secret itself, only its last four characters. */
export function publicWebhookMeta(meta: WebhookMeta): Omit<WebhookMeta, "secret"> & { secretHint: string | null } {
  const { secret, ...rest } = meta;
  return { ...rest, secretHint: secret ? secret.slice(-4) : null };
}

export function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * Only a public http(s) address may receive a webhook: no localhost, no
 * private or link-local address (the cloud metadata endpoint lives there),
 * no credentials in the URL. Returns the reason when refused.
 */
export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter a full address starting with https://";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "The address must start with https://";
  if (u.username || u.password) return "Leave the user name and password out of the address";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return "Use a public address, not a local one";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "Use a public address, not a local one";
  }
  if (PRIVATE_V4.some((re) => re.test(host))) return "Use a public address, not a private network one";
  if (host.includes(":")) {
    // IPv6 literal: loopback, unique local and link local are private.
    if (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:")) {
      return "Use a public address, not a private network one";
    }
  }
  return null;
}

export interface Delivery {
  ok: boolean;
  httpStatus: number;
  durationMs: number;
  message?: string;
}

/** POST one signed JSON body. Never throws; a 10 second timeout. */
export async function deliverWebhook(args: { url: string; secret: string; event: string; body: unknown }): Promise<Delivery> {
  const started = Date.now();
  const problem = webhookUrlProblem(args.url);
  if (problem) return { ok: false, httpStatus: 0, durationMs: 0, message: problem };
  const body = JSON.stringify(args.body);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "WorkwrK-Automations/1",
        "x-workwrk-event": args.event,
        "x-workwrk-delivery": randomUUID(),
        "x-workwrk-timestamp": String(timestamp),
        "x-workwrk-signature": signBody(args.secret, timestamp, body),
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    return { ok: res.ok, httpStatus: res.status, durationMs: Date.now() - started, ...(res.ok ? {} : { message: `The address answered ${res.status}` }) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, httpStatus: 0, durationMs: Date.now() - started, message: aborted ? "The address did not answer within 10 seconds" : "Couldn't reach the address" };
  } finally {
    clearTimeout(timer);
  }
}
