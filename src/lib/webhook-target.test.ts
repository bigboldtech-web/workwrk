// Where a webhook may be sent (the final security review, 2026-10-19):
// POST /api/webhooks took any address that began with https://, and every
// delivery went wherever its name resolved, following redirects. Now one
// check, used on create and at every send, takes a public https address
// only, and the send connects to the addresses that check resolved.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { LookupAddress } from "node:dns";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  dns: new Map<string, Array<{ address: string; family: number }>>(),
  dnsCalls: [] as Array<{ host: string; opts: unknown }>,
  requests: [] as Array<Record<string, unknown>>,
  ended: [] as string[],
}));

vi.mock("node:dns/promises", () => {
  const lookup = async (host: string, opts: unknown) => {
    st.dnsCalls.push({ host, opts });
    const found = st.dns.get(host);
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return found;
  };
  return { lookup, default: { lookup } };
});

vi.mock("node:https", () => {
  const request = (options: Record<string, unknown>, onResponse: (res: unknown) => void) => {
    st.requests.push(options);
    const req = Object.assign(new EventEmitter(), {
      end: (body: string) => {
        st.ended.push(body);
        const res = Object.assign(Readable.from([Buffer.from("ok")]), { statusCode: 202, headers: {} });
        queueMicrotask(() => onResponse(res));
      },
    });
    return req;
  };
  return { request, default: { request } };
});

import { checkWebhookTarget, pinnedLookup, sendPinned, type PublicWebhookTarget } from "./webhook-target";

const PUBLIC4 = { address: "93.184.216.34", family: 4 };
const PUBLIC6 = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 };

beforeEach(() => {
  st.dns = new Map([
    ["hooks.example.com", [PUBLIC4, PUBLIC6]],
    ["v4.example.com", [PUBLIC4]],
    ["mixed.example.com", [PUBLIC4, { address: "10.0.0.5", family: 4 }]],
    ["mixed6.example.com", [PUBLIC6, { address: "::1", family: 6 }]],
    ["rebind.example.com", [{ address: "127.0.0.1", family: 4 }]],
    ["metadata.example.com", [{ address: "169.254.169.254", family: 4 }]],
    ["mapped.example.com", [{ address: "::ffff:10.0.0.5", family: 6 }]],
    ["empty.example.com", []],
  ]);
  st.dnsCalls = [];
  st.requests = [];
  st.ended = [];
});

const reason = async (url: unknown) => {
  const t = await checkWebhookTarget(url);
  return t.ok ? "ok" : t.reason;
};

describe("checkWebhookTarget", () => {
  it("takes a public https address, any port, and resolves every address of its name", async () => {
    const t = await checkWebhookTarget("https://hooks.example.com:8443/in?x=1");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.host).toBe("hooks.example.com");
    expect(t.url.port).toBe("8443");
    expect(t.addresses).toEqual([PUBLIC4, PUBLIC6]);
    expect(st.dnsCalls).toEqual([{ host: "hooks.example.com", opts: { all: true } }]);
  });

  it("refuses http and every other scheme, and an address that is not one", async () => {
    for (const url of ["http://hooks.example.com/in", "ftp://hooks.example.com/", "ws://hooks.example.com/", "file:///etc/passwd"]) {
      expect(await reason(url), url).toBe("not_https");
    }
    for (const url of ["", "https://", "hooks.example.com/in", "not a url", 7, null]) {
      expect(await reason(url), String(url)).toBe("invalid");
    }
    expect(st.dnsCalls).toEqual([]);
  });

  it("refuses a user name or password in the address", async () => {
    expect(await reason("https://user:pass@hooks.example.com/in")).toBe("userinfo");
    expect(await reason("https://user@hooks.example.com/in")).toBe("userinfo");
    expect(await reason("https://:pass@hooks.example.com/in")).toBe("userinfo");
    expect(st.dnsCalls).toEqual([]);
  });

  it("refuses every private IPv4 range written as the host", async () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", // loopback
      "10.0.0.5", "10.255.255.255", // 10/8
      "172.16.0.1", "172.31.255.255", // 172.16/12
      "192.168.0.1", "192.168.255.255", // 192.168/16
      "169.254.169.254", "169.254.0.1", // link-local, the metadata service
      "100.64.0.1", "100.127.255.255", // CGNAT 100.64/10
      "0.0.0.0", "0.1.2.3", // 0.0.0.0/8, unspecified
      "224.0.0.1", "239.255.255.255", // multicast
      "255.255.255.255", "240.0.0.1", // broadcast, reserved
      "192.0.2.1", "198.51.100.7", "203.0.113.9", // documentation
      "198.18.0.1", "198.19.255.255", // benchmarking
      "192.0.0.8", // IETF protocol assignments
    ]) {
      expect(await reason(`https://${ip}/in`), ip).toBe("not_public");
      expect(await reason(`https://${ip}:8443/in`), `${ip}:8443`).toBe("not_public");
    }
    expect(st.dnsCalls).toEqual([]);
  });

  it("reads every spelling of an IPv4 host as the address it is", async () => {
    for (const url of ["https://2130706433/", "https://0x7f.0.0.1/", "https://0177.0.0.1/", "https://127.1/", "https://10.0.0.5./"]) {
      expect(await reason(url), url).toBe("not_public");
    }
  });

  it("refuses private IPv6 hosts, and IPv4 written inside IPv6", async () => {
    for (const ip of [
      "::1", "::", // loopback, unspecified
      "fc00::1", "fd12:3456::1", // unique local fc00::/7
      "fe80::1", "febf::1", // link-local fe80::/10
      "ff02::1", // multicast
      "2001:db8::1", // documentation
      "::ffff:127.0.0.1", "::ffff:10.0.0.5", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:192.168.1.1", // mapped
      "::127.0.0.1", // compatible
      "64:ff9b::a00:5", // NAT64 of 10.0.0.5
      "2002:a00:5::1", // 6to4 of 10.0.0.5
    ]) {
      expect(await reason(`https://[${ip}]/in`), ip).toBe("not_public");
    }
    expect(st.dnsCalls).toEqual([]);
  });

  it("takes a public IP written as the host, v4 or v6, without a lookup", async () => {
    const v4 = await checkWebhookTarget("https://93.184.216.34:9000/in");
    expect(v4).toMatchObject({ ok: true, host: "93.184.216.34", addresses: [{ address: "93.184.216.34", family: 4 }] });
    const v6 = await checkWebhookTarget("https://[2606:4700:4700::1111]/in");
    expect(v6).toMatchObject({ ok: true, host: "2606:4700:4700::1111", addresses: [{ address: "2606:4700:4700::1111", family: 6 }] });
    expect(st.dnsCalls).toEqual([]);
  });

  it("refuses localhost names, local names and a name with no dot, before any lookup", async () => {
    for (const url of [
      "https://localhost/", "https://localhost:8443/in", "https://LOCALHOST/", "https://localhost./",
      "https://app.localhost/", "https://a.b.localhost/",
      "https://printer.local/", "https://db.internal/", "https://metadata.google.internal/",
      "https://intranet/", "https://router:8443/",
    ]) {
      expect(await reason(url), url).toBe("not_public");
    }
    expect(st.dnsCalls).toEqual([]);
  });

  it("refuses a name when any address it resolves to is private, whatever else it resolves to", async () => {
    for (const host of ["mixed.example.com", "mixed6.example.com", "rebind.example.com", "metadata.example.com", "mapped.example.com"]) {
      expect(await reason(`https://${host}/in`), host).toBe("not_public");
    }
  });

  it("refuses a name that resolves to nothing", async () => {
    expect(await reason("https://nowhere.example.com/in")).toBe("unresolved");
    expect(await reason("https://empty.example.com/in")).toBe("unresolved");
  });

  it("takes a resolver of the caller's, and stops at the caller's signal", async () => {
    const t = await checkWebhookTarget("https://custom.example.org/", { resolve: async () => [PUBLIC4] });
    expect(t.ok).toBe(true);
    const c = new AbortController();
    const pending = checkWebhookTarget("https://slow.example.org/", { signal: c.signal, resolve: () => new Promise<LookupAddress[]>(() => {}) });
    c.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("pinnedLookup", () => {
  const lookup = pinnedLookup("hooks.example.com", [PUBLIC4, PUBLIC6]);
  const call = (host: string, opts: unknown) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      lookup(host, opts as never, (err, address, family) => resolve({ err, address, family })),
    );

  it("answers only with the checked addresses, all of them or the first, by family", async () => {
    expect((await call("hooks.example.com", { all: true })).address).toEqual([PUBLIC4, PUBLIC6]);
    expect(await call("hooks.example.com", {})).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    expect(await call("hooks.example.com", { family: 6 })).toMatchObject({ err: null, address: PUBLIC6.address, family: 6 });
    expect((await call("hooks.example.com", { all: true, family: "IPv4" })).address).toEqual([PUBLIC4]);
    expect(await call("hooks.example.com", 6)).toMatchObject({ address: PUBLIC6.address });
  });

  it("never asks DNS, and answers nothing for another name", async () => {
    st.dns.set("hooks.example.com", [{ address: "127.0.0.1", family: 4 }]);
    expect((await call("hooks.example.com", { all: true })).address).toEqual([PUBLIC4, PUBLIC6]);
    const other = await call("evil.example.com", { all: true });
    expect(other.err).toMatchObject({ code: "ENOTFOUND" });
    expect(st.dnsCalls).toEqual([]);
  });
});

describe("sendPinned", () => {
  it("POSTs to the checked host and port through the pinned lookup, on a socket of its own", async () => {
    const t = (await checkWebhookTarget("https://hooks.example.com:8443/in/path?x=1")) as PublicWebhookTarget;
    const signal = new AbortController().signal;
    const res = await sendPinned(t, { headers: { "Content-Type": "application/json" }, body: '{"a":"é"}', signal });
    expect(res.status).toBe(202);
    expect(await new Response(res.body).text()).toBe("ok");
    expect(st.requests).toHaveLength(1);
    const o = st.requests[0];
    expect(o).toMatchObject({ protocol: "https:", hostname: "hooks.example.com", port: 8443, path: "/in/path?x=1", method: "POST", agent: false, signal });
    expect(o.headers).toMatchObject({ "Content-Type": "application/json", "Content-Length": "10" });
    expect(st.ended).toEqual(['{"a":"é"}']);
    // The lookup the socket uses answers with the checked addresses, even once DNS says otherwise.
    st.dns.set("hooks.example.com", [{ address: "10.0.0.5", family: 4 }]);
    const pinned = await new Promise((resolve) =>
      (o.lookup as ReturnType<typeof pinnedLookup>)("hooks.example.com", { all: true }, (_e, address) => resolve(address)),
    );
    expect(pinned).toEqual([PUBLIC4, PUBLIC6]);
  });

  it("uses port 443 when the address names none", async () => {
    const t = (await checkWebhookTarget("https://v4.example.com/in")) as PublicWebhookTarget;
    await sendPinned(t, { headers: {}, body: "{}", signal: new AbortController().signal });
    expect(st.requests[0]).toMatchObject({ hostname: "v4.example.com", port: 443, path: "/in" });
  });
});
