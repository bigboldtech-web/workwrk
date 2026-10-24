// The per-address limits key an IPv6 caller by its /64 (final review of the
// MCP server, security L3): one machine is handed a whole /64, so a full
// address per bucket let it spend a fresh bucket on every request. IPv4 is
// counted as it was. Fails on fcca4075: there was no addressKey, and each
// limit below counted 2001:db8:1:2::a and 2001:db8:1:2::b apart.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unknownTokenBlocked, unknownTokenFailed, UNKNOWN_TOKENS_PER_MINUTE, resetUnknownTokenFailures } from "@/lib/mcp/limits";
import { addressKey, authorizeLimit, registerLimit, revokeAnonLimit, tokenAnonLimit } from "./limits";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.MCP_PROOF_LIMITS;
  resetUnknownTokenFailures();
});
afterEach(() => {
  process.env = { ...saved };
});

let seq = 0;
/** A /64 no other test uses, and an address in it. */
function net(): { at: (host: string) => string } {
  seq += 1;
  const prefix = `2001:db8:${seq.toString(16)}:${(seq * 7).toString(16)}`;
  return { at: (host) => `${prefix}::${host}` };
}

describe("addressKey", () => {
  it("keys an IPv6 address by its /64, however it is written", () => {
    const key = "2001:db8:85a3:8d3::/64";
    for (const a of [
      "2001:db8:85a3:8d3::1",
      "2001:0db8:85a3:08d3:1319:8a2e:0370:7344",
      "2001:DB8:85A3:8D3:ffff:ffff:ffff:ffff",
      "[2001:db8:85a3:8d3::7]",
      "2001:db8:85a3:8d3::7%eth0",
      "2001:db8:85a3:8d3:0:0:192.0.2.1",
    ]) {
      expect(addressKey(a), a).toBe(key);
    }
    expect(addressKey("2001:db8:85a3:8d4::1")).toBe("2001:db8:85a3:8d4::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("fe80::1")).toBe("fe80:0:0:0::/64");
  });

  it("leaves IPv4 as it is, reads IPv4 written as IPv6 as IPv4, and keeps junk apart", () => {
    expect(addressKey("198.51.100.7")).toBe("198.51.100.7");
    expect(addressKey("198.51.100.8")).toBe("198.51.100.8");
    expect(addressKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(addressKey("0:0:0:0:0:ffff:c633:6407")).toBe("198.51.100.7");
    expect(addressKey("unknown")).toBe("unknown");
    for (const junk of ["1:::2", "1:2:3:4:5:6:7:8:9", "12345::1", "::ffff:300.1.1.1"]) expect(addressKey(junk), junk).toBe(junk);
  });
});

describe("the per-address limits count one /64 as one caller", () => {
  it("authorize: 300 per 10 minutes for the whole /64, a fresh address in it refused once spent", () => {
    const n = net();
    for (let i = 0; i < 300; i += 1) expect(authorizeLimit(n.at((i + 1).toString(16))).ok).toBe(true);
    expect(authorizeLimit(n.at("ffff")).ok).toBe(false);
    // Another /64, and IPv4, have their own.
    expect(authorizeLimit(net().at("1")).ok).toBe(true);
  });

  it("registration: 60 a minute for the whole /64; IPv4 addresses still each their own", () => {
    const n = net();
    for (let i = 0; i < 60; i += 1) expect(registerLimit(n.at((i + 1).toString(16))).ok).toBe(true);
    expect(registerLimit(n.at("abcd")).ok).toBe(false);
    for (let i = 0; i < 61; i += 1) expect(registerLimit(`203.0.113.${i}`).ok, String(i)).toBe(true);
  });

  it("the token and revocation endpoints without a credential: 120 a minute for the whole /64", () => {
    for (const limit of [tokenAnonLimit, revokeAnonLimit]) {
      const n = net();
      for (let i = 0; i < 120; i += 1) expect(limit(n.at((i + 1).toString(16))).ok).toBe(true);
      expect(limit(n.at("beef")).ok).toBe(false);
    }
  });

  it("the MCP endpoint's failed lookups of unknown tokens: counted for the whole /64", () => {
    const n = net();
    const now = Date.now();
    for (let i = 0; i < UNKNOWN_TOKENS_PER_MINUTE; i += 1) unknownTokenFailed(n.at((i + 1).toString(16)), now);
    expect(unknownTokenBlocked(n.at("9999"), now).ok).toBe(false);
    expect(unknownTokenBlocked(net().at("1"), now).ok).toBe(true);
  });
});
