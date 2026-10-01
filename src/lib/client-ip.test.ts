import { describe, expect, it } from "vitest";
import { clientIpFrom, clientIpFromHeaders, clientIpFromRecord } from "./client-ip";

describe("clientIpFromHeaders", () => {
  it("takes x-real-ip first: nginx sets it and replaces whatever the client sent", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": " 198.51.100.4 " }))).toBe("198.51.100.4");
  });

  it("then the LAST x-forwarded-for hop, never the client's own first hop", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6,7.7.7.7, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": " 192.0.2.1 " }))).toBe("192.0.2.1");
  });

  it("a client rotating its claimed address still lands in one bucket", () => {
    const seen = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((claim) =>
        clientIpFromHeaders(new Headers({ "x-forwarded-for": `${claim}, 203.0.113.9`, "x-real-ip": "203.0.113.9" })),
      ),
    );
    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("reads IPv6 and IPv4-mapped addresses", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "::1" }))).toBe("::1");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "::ffff:127.0.0.1" }))).toBe("::ffff:127.0.0.1");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "2001:db8::7" }))).toBe("2001:db8::7");
  });

  it("an empty last hop is nothing, not the hop before it", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1, " }))).toBeNull();
  });

  it("junk is never an address: it falls through, and nothing known is null", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "unknown", "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "<script>" }))).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "x".repeat(500) }))).toBeNull();
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "9".repeat(46) }))).toBeNull();
    expect(clientIpFromHeaders(new Headers())).toBeNull();
    expect(clientIpFromHeaders(null)).toBeNull();
    expect(clientIpFromHeaders(undefined)).toBeNull();
  });
});

describe("clientIpFromRecord", () => {
  it("reads NextAuth's plain header object the same way", () => {
    expect(clientIpFromRecord({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })).toBe("203.0.113.9");
    expect(clientIpFromRecord({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" })).toBe("198.51.100.4");
    expect(clientIpFromRecord({ "x-forwarded-for": ["6.6.6.6", "203.0.113.9"] })).toBe("203.0.113.9");
    expect(clientIpFromRecord({})).toBeNull();
    expect(clientIpFromRecord(null)).toBeNull();
  });
});

describe("clientIpFrom", () => {
  it("only asks for the two proxy headers", () => {
    const asked: string[] = [];
    clientIpFrom((name) => {
      asked.push(name);
      return null;
    });
    expect(asked).toEqual(["x-real-ip", "x-forwarded-for"]);
  });
});
