// One GET to a PUBLIC address on the internet, for every server-side fetch of
// an address a person typed (a link preview, a file added by link).
//
// Pen test 2026-11-28: the link preview's own block read only the host as
// written, so ::ffff:7f00:1 and a trailing dot reached this server (V-20), and
// a file's Summarize fetched any address with no check at all, redirects
// followed (V-09): internal services, the cloud metadata address and this
// server's own API, with the error text as a port scanner.
//
// The rule is the webhook one (src/lib/webhook-target.ts, the final security
// review 2026-10-19): every address the name resolves to must be public, the
// connection goes only to those checked addresses (no DNS rebinding), and a
// redirect is never followed blindly: each hop is checked again, at most
// `maxRedirects` of them.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { checkWebhookTarget, pinnedLookup, type PublicWebhookTarget } from "@/lib/webhook-target";

export type PublicFetchRefusal = "invalid" | "not_public" | "unresolved" | "too_many_redirects" | "failed";

export type PublicFetchAnswer =
  | { ok: true; status: number; contentType: string; url: URL; body: ReadableStream<Uint8Array> | null }
  | { ok: false; reason: PublicFetchRefusal };

type Lookup = Parameters<typeof checkWebhookTarget>[1] extends infer O ? (O extends { resolve?: infer R } ? R : never) : never;

function getPinned(target: PublicWebhookTarget, headers: Record<string, string>, signal: AbortSignal) {
  return new Promise<{ status: number; location: string | null; contentType: string; body: ReadableStream<Uint8Array> | null }>((resolve, reject) => {
    const https = target.url.protocol === "https:";
    const req = (https ? httpsRequest : httpRequest)(
      {
        protocol: target.url.protocol,
        hostname: target.host,
        port: target.url.port ? Number(target.url.port) : https ? 443 : 80,
        path: `${target.url.pathname}${target.url.search}`,
        method: "GET",
        headers: { ...headers, Host: target.url.host },
        lookup: pinnedLookup(target.host, target.addresses),
        agent: false,
        signal,
        ...(https ? { servername: target.host } : {}),
      },
      (res) => {
        signal.addEventListener("abort", () => res.destroy(), { once: true });
        const loc = res.headers.location;
        resolve({
          status: res.statusCode ?? 0,
          location: typeof loc === "string" ? loc : null,
          contentType: String(res.headers["content-type"] ?? ""),
          body: Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>,
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET a public http(s) address. Never throws: a refused or failed fetch
 * answers `{ ok: false, reason }`, which callers turn into their own message
 * (never the reason itself, so no caller becomes a port scanner).
 */
export async function fetchPublic(
  raw: string,
  opts: { signal: AbortSignal; headers?: Record<string, string>; maxRedirects?: number; resolve?: Lookup },
): Promise<PublicFetchAnswer> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = raw;
  for (let hop = 0; ; hop++) {
    let target;
    try {
      target = await checkWebhookTarget(current, { signal: opts.signal, schemes: ["https:", "http:"], resolve: opts.resolve });
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (!target.ok) return { ok: false, reason: target.reason === "unresolved" ? "unresolved" : target.reason === "not_public" ? "not_public" : "invalid" };
    let answer;
    try {
      answer = await getPinned(target, opts.headers ?? {}, opts.signal);
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      await answer.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) return { ok: false, reason: "too_many_redirects" };
      try {
        current = new URL(answer.location, target.url).toString();
      } catch {
        return { ok: false, reason: "invalid" };
      }
      continue;
    }
    return { ok: true, status: answer.status, contentType: answer.contentType, url: target.url, body: answer.body };
  }
}

/** Read a body up to `maxBytes`; the rest is never downloaded. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number, stopAt?: (recentText: string) => boolean): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!body) return { bytes: new Uint8Array(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  const decoder = stopAt ? new TextDecoder() : null;
  // stopAt sees the recent text only: a growing whole re-scanned on every
  // chunk was quadratic for a server trickling tiny chunks.
  let recent = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - received;
      if (value.length > room) {
        chunks.push(value.subarray(0, room));
        received += room;
        truncated = true;
        break;
      }
      chunks.push(value);
      received += value.length;
      if (decoder && stopAt) {
        recent = (recent + decoder.decode(value, { stream: true })).slice(-16_384);
        if (stopAt(recent)) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return { bytes: out, truncated };
}
