// A page served from a private address is closed before it is read
// (src/lib/browser/addresses.ts, Decision 10), however the address is
// written; a public one is not, and anything unreadable fails closed.

import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./addresses";

describe("isPrivateAddress", () => {
  it("reads every private IPv4 range as private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.0.8", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("reads public IPv4 addresses as public", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "1.1.1.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("reads private IPv6 ranges, and IPv4 written inside IPv6, as private", () => {
    for (const ip of ["::1", "::", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1%eth0", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "2001:db8::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("reads public IPv6 addresses as public", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("fails closed on anything it cannot read", () => {
    for (const ip of ["", "   ", "localhost", "999.1.1.1", "1:2:3", "::1::2", null, undefined]) expect(isPrivateAddress(ip as string), String(ip)).toBe(true);
  });
});
