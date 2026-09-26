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
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

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

/** Pure: is this IPv4 dotted quad one a webhook must never reach. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && Number(m[3]) === 0)
  );
}

/** The IPv4 address an IPv6 form carries inside it (mapped, NAT64, 6to4), if any. */
function embeddedIPv4(v6: string): string | null {
  const h = v6.toLowerCase();
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return dotted[1];
  const groups = expandIPv6(h);
  if (!groups) return null;
  const quad = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // ::ffff:a.b.c.d and ::a.b.c.d (mapped, compatible)
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) return quad(groups[6], groups[7]);
  // 64:ff9b::/96 (NAT64)
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return quad(groups[6], groups[7]);
  // 2002::/16 (6to4)
  if (groups[0] === 0x2002) return quad(groups[1], groups[2]);
  return null;
}

function expandIPv6(h: string): number[] | null {
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array.from({ length: fill }, () => "0"), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** Pure: is this address (v4 or v6) one a webhook must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!host.includes(":")) return isPrivateIPv4(host);
  const v4 = embeddedIPv4(host);
  if (v4) return isPrivateIPv4(v4);
  const g = expandIPv6(host);
  if (!g) return true; // unreadable: refuse rather than guess
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Only a public http(s) address may receive a webhook: no localhost, no
 * private or link-local address (the cloud metadata endpoint lives there),
 * no credentials in the URL. Returns the reason when refused. This reads
 * how the address is WRITTEN; deliverWebhook also checks every address a
 * name resolves to, at the moment it connects.
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
  if ((isIP(host) || host.includes(":")) && isPrivateAddress(host)) return "Use a public address, not a private network one";
  if (isIP(host) && ownAddresses().has(host)) return "Use a public address, not this server's own";
  return null;
}

/** This server's own interface addresses: a webhook never loops back to it. */
function ownAddresses(): Set<string> {
  const out = new Set<string>();
  try {
    for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) out.add(a.address.toLowerCase());
  } catch {
    /* no interfaces readable: the private-range checks still apply */
  }
  return out;
}

/**
 * The connect-time lookup: resolves the name, and refuses when ANY address
 * it resolves to is private, loopback, link local or this server's own. The
 * socket connects to the address checked here, so a name that re-resolves to
 * an internal address between a check and the connect cannot slip through.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (addresses as LookupAddress[]) ?? [];
    const own = ownAddresses();
    const bad = list.length === 0 || list.some((a) => isPrivateAddress(a.address) || own.has(a.address.toLowerCase()));
    if (bad) {
      const e = new Error("private address") as NodeJS.ErrnoException;
      e.code = "EWEBHOOKPRIVATE";
      return callback(e, "", 4);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export interface Delivery {
  ok: boolean;
  httpStatus: number;
  durationMs: number;
  message?: string;
}

/**
 * POST one signed JSON body. Never throws; a 10 second timeout. A caller
 * that may send the same thing twice (a retried automation step) passes a
 * stable `deliveryId`, so the receiver can drop the repeat.
 */
export async function deliverWebhook(args: { url: string; secret: string; event: string; body: unknown; deliveryId?: string }): Promise<Delivery> {
  const started = Date.now();
  const problem = webhookUrlProblem(args.url);
  if (problem) return { ok: false, httpStatus: 0, durationMs: 0, message: problem };
  const body = JSON.stringify(args.body);
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(args.url);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Delivery>((resolve) => {
    let settled = false;
    const done = (d: Delivery) => {
      if (settled) return;
      settled = true;
      resolve(d);
    };
    // No redirects are followed: a 3xx is an answer, like any other status.
    const req = send(
      url,
      {
        method: "POST",
        lookup: guardedLookup,
        timeout: 10_000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "WorkwrK-Automations/1",
          "x-workwrk-event": args.event,
          "x-workwrk-delivery": args.deliveryId ?? randomUUID(),
          "x-workwrk-timestamp": String(timestamp),
          "x-workwrk-signature": signBody(args.secret, timestamp, body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        const ok = status >= 200 && status < 300;
        done({ ok, httpStatus: status, durationMs: Date.now() - started, ...(ok ? {} : { message: `The address answered ${status}` }) });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, httpStatus: 0, durationMs: Date.now() - started, message: "The address did not answer within 10 seconds" });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        httpStatus: 0,
        durationMs: Date.now() - started,
        message: err.code === "EWEBHOOKPRIVATE" ? "Use a public address, not a private network one" : "Couldn't reach the address",
      });
    });
    req.end(body);
  });
}
