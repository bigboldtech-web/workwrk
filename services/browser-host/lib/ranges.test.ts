// The firewall's ranges held to the app's own (docs/plans/browser-host.md
// 5.4 and Step 3): blocked_v4 is exactly src/lib/browser/addresses.ts
// privateV4, at every range's edges and over 200,000 seeded addresses.

import { describe, expect, it } from "vitest";

import { isPrivateAddress } from "../../../src/lib/browser/addresses";
import { BLOCKED_V4, blockedV4, cidrSpan, intToV4, isSessionIp, lowestFreeSubnet, sessionSubnet, SESSION_SUBNETS, v4ToInt } from "./ranges.mjs";

/** A seeded generator (mulberry32), so a failure names the same address every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("blockedV4 equals the app's isPrivateAddress", () => {
  it("at every range's first and last address, and the addresses just outside them", () => {
    const edges: string[] = [];
    for (const c of BLOCKED_V4) {
      const s = cidrSpan(c)!;
      for (const n of [s.first - 1, s.first, s.first + 1, s.last - 1, s.last, s.last + 1]) if (n >= 0 && n <= 0xffffffff) edges.push(intToV4(n));
    }
    expect(edges.length).toBeGreaterThan(60);
    const differ = edges.filter((ip) => blockedV4(ip) !== isPrivateAddress(ip));
    expect(differ).toEqual([]);
    // The edges themselves: inside blocked, the neighbours outside a range read as the app reads them.
    expect(blockedV4("10.0.0.0")).toBe(true);
    expect(blockedV4("9.255.255.255")).toBe(false);
    expect(blockedV4("11.0.0.0")).toBe(false);
    expect(blockedV4("100.63.255.255")).toBe(false);
    expect(blockedV4("100.128.0.0")).toBe(false);
    expect(blockedV4("223.255.255.255")).toBe(false);
    expect(blockedV4("224.0.0.0")).toBe(true);
    expect(blockedV4("255.255.255.255")).toBe(true);
  });

  it("over 200,000 seeded random addresses", () => {
    const rand = seeded(20261020);
    const differ: string[] = [];
    for (let i = 0; i < 200_000; i += 1) {
      const ip = intToV4(Math.floor(rand() * 4294967296));
      if (blockedV4(ip) !== isPrivateAddress(ip)) differ.push(ip);
    }
    expect(differ.slice(0, 5)).toEqual([]);
  });

  it("reads anything that is not an IPv4 address as blocked, as the app does", () => {
    for (const bad of ["", "1.2.3", "256.1.1.1", "a.b.c.d", "::1"]) expect(blockedV4(bad)).toBe(true);
  });
});

describe("the session pool", () => {
  it("holds 4,096 /28s of 10.250.0.0/16, gateway at +1 and the container at +2", () => {
    expect(SESSION_SUBNETS).toBe(4096);
    expect(sessionSubnet(0)).toEqual({ subnet: "10.250.0.0/28", gateway: "10.250.0.1", ip: "10.250.0.2" });
    expect(sessionSubnet(1)).toEqual({ subnet: "10.250.0.16/28", gateway: "10.250.0.17", ip: "10.250.0.18" });
    expect(sessionSubnet(4095)).toEqual({ subnet: "10.250.255.240/28", gateway: "10.250.255.241", ip: "10.250.255.242" });
    expect(isSessionIp("10.250.0.18")).toBe(true);
    expect(isSessionIp("10.250.0.17")).toBe(false);
    expect(isSessionIp("10.251.0.2")).toBe(false);
  });

  it("takes the lowest free /28, skipping any subnet another network overlaps", () => {
    expect(lowestFreeSubnet([])?.subnet).toBe("10.250.0.0/28");
    expect(lowestFreeSubnet(["10.250.0.0/28", "10.250.0.32/28"])?.subnet).toBe("10.250.0.16/28");
    // A wider network elsewhere covering the first 64 addresses.
    expect(lowestFreeSubnet(["10.250.0.0/26", "172.30.0.0/24"])?.subnet).toBe("10.250.0.64/28");
    const all = Array.from({ length: 4096 }, (_, i) => sessionSubnet(i).subnet);
    expect(lowestFreeSubnet(all)).toBeNull();
    expect(v4ToInt("10.250.0.64")).toBe((10 << 24) + (250 << 16) + 64);
  });
});
