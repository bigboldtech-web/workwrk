// Where a delivery goes (the final security review, 2026-10-19). Every send
// was a bare fetch to the subscription's address: no check of where its name
// resolved, and redirects followed. So a subscription to a public name that
// answered 307 to http://127.0.0.1:3002/ or http://169.254.169.254/ had the
// server re-send the body and its signature there, a name resolving to a
// 10.x host was sent to it, and the answer, or the socket's error text, came
// back through the delivery's responseBody. Now every send checks the
// address at that moment, connects only to the addresses the check
// resolved, fails a redirect without following it, and keeps a fixed
// sentence on the delivery.
//
// The network here is a fake one: node:https and node:dns/promises are
// mocked, and fetch is stubbed as it behaved (it resolves the name when it
// connects, and follows redirects unless told not to). Nothing leaves the
// process.

import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { status: number; body: string; headers?: Record<string, string> } | Error;

const st = vi.hoisted(() => ({
  /** What each name resolves to, answer by answer: the last one repeats. */
  dns: new Map<string, string[][]>(),
  dnsCalls: [] as string[],
  /** Every connection the fake network took: the address it reached, and what it carried. */
  hits: [] as Array<{ address: string; port: number; path: string; signature: string | undefined; body: string }>,
  /** How an address answers, by address; any other answers 200 "ok". */
  routes: new Map<string, (path: string) => Answer>(),
  /** Every node:https request's options. */
  httpsOptions: [] as Array<Record<string, unknown>>,
  /** What each socket's lookup answered, by host. */
  socketLookups: [] as Array<{ host: string; addresses: unknown }>,
  subs: [] as Array<{ id: string; url: string; secretHash: string; secretSealed: unknown }>,
  due: [] as Array<Record<string, unknown>>,
  deliveries: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  subUpdates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  failureCount: new Map<string, number>(),
  created: 0,
}));

function resolveNow(host: string): string[] {
  st.dnsCalls.push(host);
  const answers = st.dns.get(host);
  if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  const n = st.dnsCalls.filter((h) => h === host).length;
  return answers[Math.min(n, answers.length) - 1];
}

/** One connection on the fake network. */
function reach(address: string, port: number, path: string, headers: Record<string, string>, body: string): Answer {
  st.hits.push({ address, port, path, signature: headers["X-Workwrk-Signature"], body });
  return st.routes.get(address)?.(path) ?? { status: 200, body: "ok" };
}

vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) => resolveNow(host).map((address) => ({ address, family: isIP(address) }));
  return { lookup, default: { lookup } };
});

vi.mock("node:https", () => {
  // A socket connects to a literal host as written, and to a name through the
  // lookup it was given (Node's own, which asks DNS, when none was).
  const request = (options: Record<string, unknown>, onResponse: (res: unknown) => void) => {
    st.httpsOptions.push(options);
    const req = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void };
    req.destroy = () => {};
    req.end = (body: string) => {
      const host = String(options.hostname);
      const connect = (address: string) => {
        const answer = reach(address, Number(options.port), String(options.path), options.headers as Record<string, string>, body);
        if (answer instanceof Error) req.emit("error", answer);
        else onResponse(Object.assign(Readable.from([Buffer.from(answer.body)]), { statusCode: answer.status, headers: answer.headers ?? {} }));
      };
      queueMicrotask(() => {
        if (isIP(host)) return connect(host);
        const lookup = options.lookup as undefined | ((h: string, o: object, cb: (e: Error | null, a: Array<{ address: string }>) => void) => void);
        if (!lookup) return connect(resolveNow(host)[0]);
        lookup(host, { all: true }, (err, list) => {
          st.socketLookups.push({ host, addresses: err ? err : list });
          if (err) req.emit("error", err);
          else connect(list[0].address);
        });
      });
    };
    return req;
  };
  return { request, default: { request } };
});

vi.mock("@/lib/automation/engine", () => ({ runAutomationsForEvent: async () => undefined }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookSubscription: {
      findMany: async () => st.subs,
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        st.subUpdates.push(a);
        const n = (st.failureCount.get(a.where.id) ?? 0) + (a.data.failureCount && typeof a.data.failureCount === "object" ? 1 : 0);
        st.failureCount.set(a.where.id, n);
        return { failureCount: n };
      },
    },
    webhookDelivery: {
      create: async () => { st.created += 1; return { id: `d${st.created}`, createdAt: new Date(Date.UTC(2026, 9, 19, 9, 0, 0)) }; },
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => { st.deliveries.push(a); return {}; },
      findMany: async () => st.due,
      updateMany: async () => ({ count: 1 }),
    },
  },
}));

const savedKey = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = "c".repeat(64);

import { sealToken } from "@/lib/connectors/seal";
import { dispatchEvent, processWebhookRetries } from "./webhookDispatcher";

const PUBLIC = "93.184.216.34";
const INTERNAL = ["127.0.0.1", "10.0.0.5", "169.254.169.254"];
const NOT_PUBLIC = "Not sent: the address is not on the public internet. Webhooks go to a public https address.";
const REDIRECT = "The address answered with a redirect; webhooks don't follow them.";

const sub = (id: string, url: string) => ({ id, url, secretHash: "h", secretSealed: sealToken("whsec_receiver") });
const due = (id: string, url: string, attemptCount = 2) => ({
  id, event: "kudos.created", payload: { id }, createdAt: new Date(), attemptCount, status: "RETRYING",
  subscription: { ...sub(`s-${id}`, url), status: "ACTIVE" },
});
const internalHits = () => st.hits.filter((h) => INTERNAL.includes(h.address));
const failuresCounted = (subId: string) => st.subUpdates.filter((u) => u.where.id === subId && typeof u.data.failureCount === "object").length;

beforeEach(() => {
  st.dns = new Map([
    ["hook.example.com", [[PUBLIC]]],
    ["bounce.example.com", [[PUBLIC]]],
    ["internal.example.com", [["10.0.0.5"]]],
    ["mixed.example.com", [[PUBLIC, "10.0.0.5"]]],
    ["metadata.example.com", [["169.254.169.254"]]],
  ]);
  st.dnsCalls = [];
  st.hits = [];
  st.routes = new Map();
  for (const ip of INTERNAL) st.routes.set(ip, () => ({ status: 200, body: `internal page of ${ip}` }));
  st.httpsOptions = [];
  st.socketLookups = [];
  st.subs = [];
  st.due = [];
  st.deliveries = [];
  st.subUpdates = [];
  st.failureCount = new Map();
  st.created = 0;
  // fetch as it behaved: it resolves the name as it connects, and follows a redirect unless told "manual".
  vi.stubGlobal("fetch", async (raw: string, init: { headers: Record<string, string>; body: string; redirect?: string }) => {
    let url = new URL(raw);
    for (let hop = 0; ; hop += 1) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const address = isIP(host) ? host : resolveNow(host)[0];
      const answer = reach(address, Number(url.port || (url.protocol === "https:" ? 443 : 80)), url.pathname, init.headers, init.body);
      if (answer instanceof Error) throw answer;
      const location = answer.headers?.location;
      if (answer.status >= 300 && answer.status < 400 && location && init.redirect !== "manual" && hop < 20) {
        url = new URL(location, url);
        continue;
      }
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    }
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedKey;
});

describe("a redirect", () => {
  it("is never followed: a 307 to an internal address is a failed delivery with a fixed reason, and nothing reaches inside", async () => {
    st.routes.set(PUBLIC, () => ({ status: 307, body: "moved", headers: { location: "http://127.0.0.1:3002/api/internal" } }));
    st.subs = [sub("s1", "https://bounce.example.com/h")];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k1" } });
    expect(internalHits()).toEqual([]);
    expect(st.hits.map((h) => h.address)).toEqual([PUBLIC]);
    expect(st.deliveries).toEqual([{ where: { id: "d1" }, data: expect.objectContaining({ status: "RETRYING", httpStatus: 307, responseBody: REDIRECT, attemptCount: 1 }) }]);
    expect(failuresCounted("s1")).toBe(1);
  });

  it("is never followed on a retry either, a 302 to the metadata service included", async () => {
    st.routes.set(PUBLIC, () => ({ status: 302, body: "", headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    st.due = [due("d-r", "https://bounce.example.com/h")];
    const out = await processWebhookRetries();
    expect(internalHits()).toEqual([]);
    expect(st.deliveries[0].data).toMatchObject({ status: "RETRYING", httpStatus: 302, responseBody: REDIRECT, attemptCount: 3 });
    expect(out).toEqual({ retried: 1, delivered: 0 });
  });
});

describe("an address that is not on the public internet", () => {
  it("sends nothing when the name resolves to a private address, and keeps a fixed reason with no internal text", async () => {
    st.subs = [sub("s2", "https://internal.example.com/h"), sub("s3", "https://mixed.example.com/h"), sub("s4", "https://metadata.example.com/latest")];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k2" } });
    expect(st.hits).toEqual([]);
    expect(st.deliveries).toHaveLength(3);
    for (const d of st.deliveries) {
      expect(d.data).toMatchObject({ status: "RETRYING", responseBody: NOT_PUBLIC, attemptCount: 1 });
      expect(d.data.httpStatus).toBeUndefined();
      expect(String(d.data.responseBody)).not.toMatch(/10\.0\.0\.5|169\.254|127\.0\.0\.1|getaddrinfo|ENOTFOUND|internal page/);
    }
    for (const id of ["s2", "s3", "s4"]) expect(failuresCounted(id)).toBe(1);
  });

  it("sends nothing to a private address written as the host, or to localhost, on a retry, and counts each as a failure", async () => {
    st.due = [due("d-ip", "https://10.0.0.5/h"), due("d-local", "https://localhost:8443/h"), due("d-meta", "https://169.254.169.254/latest"), due("d-v6", "https://[::ffff:127.0.0.1]:3002/h")];
    const out = await processWebhookRetries();
    expect(st.hits).toEqual([]);
    expect(st.deliveries.map((d) => [d.where.id, d.data.responseBody, d.data.attemptCount])).toEqual([
      ["d-ip", NOT_PUBLIC, 3], ["d-local", NOT_PUBLIC, 3], ["d-meta", NOT_PUBLIC, 3], ["d-v6", NOT_PUBLIC, 3],
    ]);
    expect(out).toEqual({ retried: 4, delivered: 0 });
  });

  it("sends nothing to an http subscription stored before addresses were checked", async () => {
    st.due = [due("d-http", "http://hook.example.com/legacy")];
    await processWebhookRetries();
    expect(st.hits).toEqual([]);
    expect(st.deliveries[0].data).toMatchObject({ status: "RETRYING", responseBody: "Not sent: the address is not https. Webhooks go to a public https address.", attemptCount: 3 });
    expect(failuresCounted("s-d-http")).toBe(1);
  });

  it("checks again at every send: a name that turned private since its last send sends nothing", async () => {
    st.dns.set("hook.example.com", [["127.0.0.1"]]);
    st.due = [due("d-turned", "https://hook.example.com/h")];
    await processWebhookRetries();
    expect(st.hits).toEqual([]);
    expect(st.deliveries[0].data).toMatchObject({ responseBody: NOT_PUBLIC });
  });

  it("pauses the subscription after ten such failures, as any failing receiver is", async () => {
    st.failureCount.set("s5", 9);
    st.subs = [sub("s5", "https://internal.example.com/h")];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k5" } });
    expect(st.subUpdates.at(-1)).toEqual({ where: { id: "s5" }, data: { status: "PAUSED" } });
  });
});

describe("a public address", () => {
  it("is sent through the pinned lookup: the socket connects to the address the check resolved, even once DNS says otherwise", async () => {
    // The first answer is public; every later one is loopback (DNS rebinding).
    st.dns.set("hook.example.com", [[PUBLIC], ["127.0.0.1"]]);
    st.subs = [sub("s6", "https://hook.example.com:8443/in?x=1")];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k6" } });
    expect(st.dnsCalls).toEqual(["hook.example.com"]);
    expect(st.httpsOptions).toHaveLength(1);
    expect(st.httpsOptions[0]).toMatchObject({ hostname: "hook.example.com", port: 8443, path: "/in?x=1", method: "POST", agent: false });
    expect(typeof st.httpsOptions[0].lookup).toBe("function");
    expect(st.socketLookups).toEqual([{ host: "hook.example.com", addresses: [{ address: PUBLIC, family: 4 }] }]);
    expect(st.hits.map((h) => [h.address, h.port, h.path])).toEqual([[PUBLIC, 8443, "/in?x=1"]]);
    expect(st.hits[0].signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(st.deliveries[0].data).toMatchObject({ status: "DELIVERED", httpStatus: 200, responseBody: "ok" });
    // And the socket's lookup, asked again now, still answers only the checked address.
    const pinned = await new Promise((resolve) =>
      (st.httpsOptions[0].lookup as (h: string, o: object, cb: (e: unknown, a: unknown) => void) => void)("hook.example.com", { all: true }, (_e, a) => resolve(a)),
    );
    expect(pinned).toEqual([{ address: PUBLIC, family: 4 }]);
    expect(st.dnsCalls).toEqual(["hook.example.com"]);
  });

  it("keeps a fixed sentence when the send gets no answer, never the socket's error text", async () => {
    st.routes.set(PUBLIC, () => Object.assign(new Error(`connect ECONNREFUSED ${PUBLIC}:8443 via 10.0.0.1`), { code: "ECONNREFUSED" }));
    st.subs = [sub("s7", "https://hook.example.com:8443/in")];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k7" } });
    expect(st.deliveries[0].data).toMatchObject({ status: "RETRYING", responseBody: "Couldn't reach the address (ECONNREFUSED)." });
    expect(failuresCounted("s7")).toBe(1);
  });
});
