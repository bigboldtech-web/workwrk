// Where a webhook subscription may send (the final security review,
// 2026-10-19). POST /api/webhooks checked only that an address began with
// https://, and every delivery was a bare fetch that followed redirects, so a
// workspace Owner or Admin could have the server POST its signed deliveries
// into its own network: a direct https://10.0.0.5/ or https://localhost:8443/,
// or a public name answering 307 to http://169.254.169.254/, with
// WebhookDelivery.responseBody and GET /api/webhooks reading the answer back.
//
// ONE CHECK, at create and at every send (checkWebhookTarget). The address
// must be https, with a host and no user name or password. A host written as
// an IP address, and every address a name resolves to, must be public: one
// private address among them refuses the whole name. Private is
// src/lib/browser/addresses.ts's isPrivateAddress (loopback, RFC 1918,
// link-local, carrier-grade NAT, 0.0.0.0/8, documentation and benchmarking
// ranges, multicast, broadcast, IPv6 unique local and link-local, and IPv4
// written inside IPv6), plus this server's own interface addresses. The names
// localhost, *.localhost, *.local and *.internal, and a name with no dot, are
// refused before any lookup. Any port is fine: receivers use their own.
//
// THE SEND GOES TO THE CHECKED ADDRESS (sendPinned). The connection's lookup
// answers only with the addresses the check resolved, so a name that resolves
// to something else a moment later (DNS rebinding) cannot move the send. The
// request is node:https: undici is not importable here (it is not in
// node_modules, and Node's built-in fetch keeps its Agent to itself), so
// fetch could not be given a pinned dispatcher. node:https never follows a
// redirect: a 3xx comes back as an answer, and the dispatcher fails it.

import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { Readable } from "node:stream";
import { isPrivateAddress } from "@/lib/browser/addresses";

/** Why an address is refused. */
export type WebhookTargetRefusal = "invalid" | "not_https" | "userinfo" | "not_public" | "unresolved";

/** An address that passed the check: the host as connected to, and the addresses it may connect to. */
export type PublicWebhookTarget = { ok: true; url: URL; host: string; addresses: LookupAddress[] };
export type WebhookTarget = PublicWebhookTarget | { ok: false; reason: WebhookTargetRefusal };

type Resolve = (host: string) => Promise<LookupAddress[]>;

const resolveAll: Resolve = (host) => dnsLookup(host, { all: true });

/** This server's own interface addresses: a webhook never comes back to it. */
function ownAddresses(): Set<string> {
  const out = new Set<string>();
  try {
    for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) out.add(a.address.toLowerCase());
  } catch {
    // No interfaces readable: the private ranges still apply.
  }
  return out;
}

function publicAddress(ip: string, own: Set<string>): boolean {
  return !isPrivateAddress(ip) && !own.has(ip.toLowerCase());
}

/** A name no public receiver has: localhost and its children, mDNS and internal names, and a name with no dot. */
function localName(host: string): boolean {
  return (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

function abortError(): Error {
  return Object.assign(new Error("The check was stopped."), { name: "AbortError" });
}

/** The lookup, stopped by the send's own timer when one is given. */
function resolveUnder(resolve: Resolve, host: string, signal?: AbortSignal): Promise<LookupAddress[]> {
  if (!signal) return resolve(host);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((ok, fail) => {
    const onAbort = () => fail(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    resolve(host).then(
      (v) => { signal.removeEventListener("abort", onAbort); ok(v); },
      (e) => { signal.removeEventListener("abort", onAbort); fail(e); },
    );
  });
}

/**
 * Whether a webhook may be sent to this address, and where (see the header).
 * Never throws for a bad address; throws only an AbortError when `signal`
 * stops the lookup.
 */
export async function checkWebhookTarget(raw: unknown, opts: { signal?: AbortSignal; resolve?: Resolve } = {}): Promise<WebhookTarget> {
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  // The URL parser has already read every spelling of an IPv4 address
  // (0x7f.1, 2130706433) as dotted, and lowered the name.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host) return { ok: false, reason: "invalid" };
  const own = ownAddresses();

  const family = isIP(host);
  if (family !== 0) {
    return publicAddress(host, own) ? { ok: true, url, host, addresses: [{ address: host, family }] } : { ok: false, reason: "not_public" };
  }
  if (localName(host)) return { ok: false, reason: "not_public" };

  let addresses: LookupAddress[];
  try {
    addresses = await resolveUnder(opts.resolve ?? resolveAll, host, opts.signal);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return { ok: false, reason: "unresolved" };
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return { ok: false, reason: "unresolved" };
  if (!addresses.every((a) => typeof a?.address === "string" && publicAddress(a.address, own))) return { ok: false, reason: "not_public" };
  return { ok: true, url, host, addresses: addresses.map((a) => ({ address: a.address, family: a.family })) };
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * The connection's lookup: answers only with the checked addresses, and only
 * for the checked host. It never asks DNS again, so the send connects to
 * what was checked.
 */
export function pinnedLookup(host: string, addresses: LookupAddress[]) {
  return (hostname: string, options: LookupOptions | number | undefined, callback: LookupCallback): void => {
    const opts: LookupOptions = typeof options === "object" && options !== null ? options : {};
    const raw = typeof options === "number" ? options : opts.family;
    const want = raw === 4 || raw === "IPv4" ? 4 : raw === 6 || raw === "IPv6" ? 6 : 0;
    const name = String(hostname).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    const list = name === host ? addresses.filter((a) => want === 0 || a.family === want) : [];
    if (list.length === 0) {
      const e = Object.assign(new Error("Not a checked address."), { code: "ENOTFOUND" }) as NodeJS.ErrnoException;
      callback(e, "", 4);
      return;
    }
    if (opts.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  };
}

/** What a send answered: its status and its body, unread. */
export type PinnedAnswer = { status: number; body: ReadableStream<Uint8Array> | null };

/**
 * One POST to a checked address, connected through pinnedLookup and never
 * following a redirect. Resolves once the answer's headers arrive; the body
 * is left to the caller, and `signal` stops the send and the body alike.
 * Rejects when no answer came.
 */
export function sendPinned(target: PublicWebhookTarget, init: { headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<PinnedAnswer> {
  return new Promise<PinnedAnswer>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: target.host,
        port: target.url.port ? Number(target.url.port) : 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: "POST",
        headers: { ...init.headers, "Content-Length": String(Buffer.byteLength(init.body)) },
        lookup: pinnedLookup(target.host, target.addresses),
        // A socket of its own: none kept alive and handed to another send.
        agent: false,
        signal: init.signal,
      },
      (res) => {
        init.signal.addEventListener("abort", () => res.destroy(abortError()), { once: true });
        resolve({ status: res.statusCode ?? 0, body: Readable.toWeb(res) as unknown as ReadableStream<Uint8Array> });
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}
