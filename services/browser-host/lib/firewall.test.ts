// The firewall's file (docs/plans/browser-host.md 5.4 and Step 3): the
// text of 5.4 from given addresses and a given uid, an atomic replace,
// every refusal a counter that rejects, and the four hooks.

import { describe, expect, it } from "vitest";

import { COUNTERS, firewallText, hostElements, listingMeaning, publicAddresses } from "./firewall.mjs";

const TEXT = firewallText({ hostV4: ["203.0.113.50", "198.51.100.7"], blockV4: ["172.236.169.129"], hostUid: 998 });
const lines = TEXT.split("\n");
const chain = (name: string) => {
  const at = lines.findIndex((l) => l.trim() === `chain ${name} {`);
  expect(at).toBeGreaterThan(0);
  const end = lines.findIndex((l, i) => i > at && l.trim() === "}");
  return lines.slice(at + 1, end).map((l) => l.trim());
};

describe("the firewall file", () => {
  it("is the text of 5.4 from the addresses and the uid", () => {
    expect(TEXT).toBe(
      [
        "table inet workwrk_browsers",
        "delete table inet workwrk_browsers",
        "table inet workwrk_browsers {",
        "  set blocked_v4 { type ipv4_addr; flags interval; elements = {",
        "    0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12,",
        "    192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24,",
        "    224.0.0.0/3 } }",
        "  set host_v4 { type ipv4_addr; flags interval; elements = { 172.236.169.129, 198.51.100.7, 203.0.113.50 } }",
        "  set resolvers_v4 { type ipv4_addr; elements = { 1.1.1.1, 1.0.0.1, 9.9.9.9, 149.112.112.112 } }",
        "",
        "  chain refuse {",
        "    meta l4proto tcp reject with tcp reset",
        "    reject with icmpx type admin-prohibited",
        "  }",
        "  chain from_session {",
        '    meta nfproto ipv6 counter comment "ipv6" jump refuse',
        "    ip daddr @resolvers_v4 udp dport 53 accept",
        "    ip daddr @resolvers_v4 tcp dport 53 accept",
        '    meta l4proto { tcp, udp } th dport 53 counter comment "other_dns" jump refuse',
        '    ip daddr @blocked_v4 counter comment "private" jump refuse',
        '    ip daddr @host_v4 counter comment "host" jump refuse',
        '    meter wkb_rate { iifname limit rate over 6 mbytes/second burst 12 mbytes } counter comment "rate" drop',
        "    tcp dport { 80, 443 } accept",
        "    udp dport 443 accept",
        '    counter comment "port" jump refuse',
        "  }",
        "  chain forward {",
        "    type filter hook forward priority filter - 10; policy accept;",
        '    iifname "wkb-*" jump from_session',
        '    oifname "wkb-*" ct state established,related accept',
        '    oifname "wkb-*" counter comment "into_session" drop',
        "  }",
        "  chain input_sessions {",
        "    type filter hook input priority filter - 10; policy accept;",
        '    iifname "wkb-*" ct state established,related accept',
        '    iifname "wkb-*" counter comment "to_host" jump refuse',
        "  }",
        "  chain output_devtools {",
        "    type filter hook output priority filter - 10; policy accept;",
        '    ip daddr 10.250.0.0/16 tcp dport 9222 meta skuid != 998 counter comment "devtools_other_user" reject with tcp reset',
        "  }",
        "  chain input_public {",
        "    type filter hook input priority filter; policy drop;",
        "    iif lo accept",
        "    ct state established,related accept",
        '    iifname "wkb-*" drop',
        "    tcp dport { 22, 80, 443 } accept",
        "    meta nfproto ipv4 udp sport 67 udp dport 68 accept",
        "    meta nfproto ipv6 udp sport 547 udp dport 546 accept",
        "    icmp type { echo-request, destination-unreachable, time-exceeded } limit rate 10/second accept",
        "    icmpv6 type { echo-request, destination-unreachable, packet-too-big, time-exceeded, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("starts by declaring, deleting and defining the table, so a load replaces it in one transaction", () => {
    expect(lines.slice(0, 3)).toEqual(["table inet workwrk_browsers", "delete table inet workwrk_browsers", "table inet workwrk_browsers {"]);
    expect(TEXT.match(/^table /gm)).toHaveLength(2);
    expect(TEXT.match(/^delete table /gm)).toHaveLength(1);
  });

  it("gives every refusal its own named counter, and refuses by jump refuse, which rejects", () => {
    expect(chain("refuse")).toEqual(["meta l4proto tcp reject with tcp reset", "reject with icmpx type admin-prohibited"]);
    const session = [...chain("from_session"), ...chain("input_sessions")];
    const refusals = session.filter((l) => l.includes("jump refuse"));
    expect(refusals.length).toBe(6);
    for (const l of refusals) expect(l).toMatch(/(^| )counter comment "[a-z_0-9]+" jump refuse$/);
    // Nothing in a session's own chains is silently dropped but the rate policer.
    expect(session.filter((l) => / drop$/.test(l))).toEqual(['meter wkb_rate { iifname limit rate over 6 mbytes/second burst 12 mbytes } counter comment "rate" drop']);
    const named = [...TEXT.matchAll(/counter comment "([a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(named).toEqual(["ipv6", "other_dns", "private", "host", "rate", "port", "into_session", "to_host", "devtools_other_user"]);
    expect(new Set(named).size).toBe(named.length);
    expect(named).toEqual([...COUNTERS]);
  });

  it("allows the four resolvers on port 53 only, and otherwise TCP 80 and 443 and UDP 443", () => {
    const fs = chain("from_session");
    expect(fs.filter((l) => l.endsWith(" accept"))).toEqual(["ip daddr @resolvers_v4 udp dport 53 accept", "ip daddr @resolvers_v4 tcp dport 53 accept", "tcp dport { 80, 443 } accept", "udp dport 443 accept"]);
    // DNS anywhere else is refused before the private and port rules, and the last rule refuses every other port.
    expect(fs.findIndex((l) => l.includes('"other_dns"'))).toBeLessThan(fs.findIndex((l) => l.startsWith("tcp dport")));
    expect(fs.at(-1)).toBe('counter comment "port" jump refuse');
    expect(TEXT).toContain("set resolvers_v4 { type ipv4_addr; elements = { 1.1.1.1, 1.0.0.1, 9.9.9.9, 149.112.112.112 } }");
  });

  it("rejects one session reaching another as private, never drops it as into_session", () => {
    // Walk the forward hook for A (wkb-aaaaaaaa) to B's DevTools (10.250.0.18:9222, on wkb-bbbbbbbb), a new connection.
    const forward = chain("forward").slice(1);
    const first = forward.find((l) => (l.startsWith('iifname "wkb-*"') ? true : l.startsWith('oifname "wkb-*"') && !l.includes("established")));
    expect(first).toBe('iifname "wkb-*" jump from_session');
    const fs = chain("from_session");
    const hit = fs.find((l) => /^ip daddr @(resolvers_v4|blocked_v4|host_v4)/.test(l) && !l.includes("resolvers_v4"));
    expect(hit).toBe('ip daddr @blocked_v4 counter comment "private" jump refuse');
  });

  it("refuses IPv6 first, before anything a session sends could be accepted", () => {
    expect(chain("from_session")[0]).toBe('meta nfproto ipv6 counter comment "ipv6" jump refuse');
  });

  it("holds the forward, input and output chains: replies only into a session, no session to the host, only the host's user to 9222", () => {
    expect(chain("forward")).toEqual([
      "type filter hook forward priority filter - 10; policy accept;",
      'iifname "wkb-*" jump from_session',
      'oifname "wkb-*" ct state established,related accept',
      'oifname "wkb-*" counter comment "into_session" drop',
    ]);
    expect(chain("input_sessions")).toEqual(["type filter hook input priority filter - 10; policy accept;", 'iifname "wkb-*" ct state established,related accept', 'iifname "wkb-*" counter comment "to_host" jump refuse']);
    expect(chain("output_devtools")).toEqual(["type filter hook output priority filter - 10; policy accept;", 'ip daddr 10.250.0.0/16 tcp dport 9222 meta skuid != 998 counter comment "devtools_other_user" reject with tcp reset']);
    const pub = chain("input_public");
    expect(pub[0]).toBe("type filter hook input priority filter; policy drop;");
    expect(pub).toContain("tcp dport { 22, 80, 443 } accept");
    expect(pub).toContain('iifname "wkb-*" drop');
  });

  it("refuses a bad address or uid rather than write a file nft would read differently", () => {
    expect(() => firewallText({ hostV4: ["not-an-ip"], blockV4: [], hostUid: 998 })).toThrow("firewall_bad_address");
    expect(() => firewallText({ hostV4: [], blockV4: ["2001:db8::1"], hostUid: 998 })).toThrow("firewall_bad_address");
    expect(() => firewallText({ hostV4: [], blockV4: [], hostUid: 0 })).toThrow("firewall_bad_uid");
    expect(hostElements(["10.0.0.2", "1.2.3.4", "10.0.0.2", "192.0.2.0/24"])).toEqual(["1.2.3.4", "10.0.0.2", "192.0.2.0/24"]);
    // The same addresses in another order make the same file.
    expect(firewallText({ hostV4: ["198.51.100.7", "203.0.113.50"], blockV4: ["172.236.169.129"], hostUid: 998 })).toBe(TEXT);
  });
});

describe("a listing's meaning", () => {
  const listing = (packets: number, extra: unknown[] = []) => ({
    nftables: [
      { metainfo: { version: "1.0.9", json_schema_version: 1 } },
      { table: { family: "inet", name: "workwrk_browsers", handle: 3 } },
      { set: { family: "inet", name: "wkb_rate", table: "workwrk_browsers", type: "ifname", handle: 9, flags: ["dynamic"], elem: packets ? [{ elem: { val: "wkb-1a2b3c4d" } }] : undefined } },
      { rule: { family: "inet", table: "workwrk_browsers", chain: "from_session", handle: 12 + packets, expr: [{ counter: { packets, bytes: packets * 60 } }, { jump: { target: "refuse" } }], comment: "private" } },
      ...extra,
    ],
  });

  it("is the same whatever the counters, handles and the meter's learnt elements say", () => {
    expect(listingMeaning(listing(0))).toBe(listingMeaning(listing(42)));
  });

  it("differs for a rule changed or added", () => {
    expect(listingMeaning(listing(0))).not.toBe(listingMeaning(listing(0, [{ rule: { chain: "forward", expr: [{ accept: null }] } }])));
  });

  it("reads the host's own addresses from ip -j, leaving out every bridge", () => {
    const ip = [
      { ifname: "lo", addr_info: [{ family: "inet", local: "127.0.0.1", scope: "host" }] },
      { ifname: "eth0", addr_info: [{ family: "inet", local: "203.0.113.50", scope: "global" }, { family: "inet", local: "192.168.140.7", scope: "global" }] },
      { ifname: "docker0", addr_info: [{ family: "inet", local: "172.30.0.1", scope: "global" }] },
      { ifname: "wkb-1a2b3c4d", addr_info: [{ family: "inet", local: "10.250.0.1", scope: "global" }] },
    ];
    expect(publicAddresses(ip)).toEqual(["203.0.113.50", "192.168.140.7"]);
  });
});
