// The firewall's loader and 5-minute check (docs/plans/browser-host.md 5.4
// and Step 3), against a fake nft that keeps a table the way the kernel
// does: a listing equal to the saved one, its counters aside, reloads
// nothing; a changed rule, a missing table or a new host address reloads
// once, and only once per change.

import { describe, expect, it } from "vitest";

import { blockFrom, firewallRun, reloadReason, type CheckDeps } from "./firewall-check.mjs";

const PATHS = { file: "/etc/fw.nft", env: "/etc/fw.env", savedDir: "/run/fw", ok: "/var/lib/fw.ok" };

/**
 * A fake machine: files, `ip`, `id` and an nft whose table holds the rules a
 * file defined. A file that does not declare and delete the table first is
 * appended to what is there, as nft does.
 */
function machine() {
  const files = new Map<string, string>([[PATHS.env, "BROWSER_HOST_BLOCK=172.236.169.129\n"]]);
  const m = {
    files,
    addresses: ["203.0.113.50"],
    table: null as null | Array<{ text: string; packets: number }>,
    commands: [] as string[],
    loads: 0,
    checks: 0,
    nftCheckFails: false,
    traffic() {
      for (const r of m.table ?? []) r.packets += 7;
    },
    deps: null as unknown as CheckDeps,
  };
  const ruleLines = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^(table |delete table |})/.test(l));
  m.deps = {
    run: async (cmd, args) => {
      m.commands.push([cmd, ...args].join(" "));
      if (cmd === "ip") return { code: 0, stdout: JSON.stringify([{ ifname: "eth0", addr_info: m.addresses.map((local) => ({ family: "inet", local, scope: "global" })) }]) };
      if (cmd === "id") return { code: 0, stdout: "998\n" };
      if (cmd === "nft" && args[0] === "-c") {
        m.checks += 1;
        return { code: m.nftCheckFails ? 1 : 0, stdout: "" };
      }
      if (cmd === "nft" && args[0] === "-f") {
        m.loads += 1;
        const text = files.get(args[1]) ?? "";
        const rules = ruleLines(text).map((t) => ({ text: t, packets: 0 }));
        const replaces = text.startsWith("table inet workwrk_browsers\ndelete table inet workwrk_browsers\n");
        m.table = replaces || !m.table ? rules : [...m.table, ...rules];
        return { code: 0, stdout: "" };
      }
      if (cmd === "nft" && args[0] === "-j") {
        if (!m.table) return { code: 1, stdout: "" };
        return {
          code: 0,
          stdout: JSON.stringify({
            nftables: [
              { metainfo: { version: "1.0.9" } },
              { table: { family: "inet", name: "workwrk_browsers", handle: 7 } },
              ...m.table.map((r, i) => ({ rule: { handle: 100 + i, text: r.text, expr: [{ counter: { packets: r.packets, bytes: r.packets * 60 } }] } })),
            ],
          }),
        };
      }
      return { code: 127, stdout: "" };
    },
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, text) => void files.set(p, text),
    now: () => Date.parse("2026-10-21T04:00:00Z"),
    log: () => undefined,
  };
  return m;
}

describe("the firewall loader", () => {
  it("checks the file with nft -c before every load, and saves the listing and the hash", async () => {
    const m = machine();
    expect(await firewallRun("load", m.deps, PATHS)).toEqual({ reloaded: true, reason: "load" });
    const c = m.commands.findIndex((x) => x === `nft -c -f ${PATHS.file}`);
    const f = m.commands.findIndex((x) => x === `nft -f ${PATHS.file}`);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(f).toBeGreaterThan(c);
    expect(m.files.get(PATHS.file)).toContain("172.236.169.129");
    expect(m.files.get(PATHS.file)).toContain("meta skuid != 998");
    expect(m.files.get("/run/fw/firewall.loaded.sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(m.files.get(PATHS.ok)).toBe("2026-10-21T04:00:00.000Z\n");
  });

  it("loads nothing, and writes no firewall.ok, when nft -c refuses the file", async () => {
    const m = machine();
    m.nftCheckFails = true;
    await expect(firewallRun("load", m.deps, PATHS)).rejects.toThrow("firewall_check_refused");
    expect(m.loads).toBe(0);
    expect(m.files.has(PATHS.ok)).toBe(false);
  });
});

describe("the 5-minute check", () => {
  it("reloads nothing for a listing equal to the saved one, its counters aside, and keeps the counters", async () => {
    const m = machine();
    await firewallRun("load", m.deps, PATHS);
    m.traffic();
    for (let i = 0; i < 3; i += 1) expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: false, reason: null });
    expect(m.loads).toBe(1);
    expect(m.table!.every((r) => r.packets === 7)).toBe(true);
    expect(m.files.get(PATHS.ok)).toBeDefined();
  });

  it("reloads a changed rule once, and only once", async () => {
    const m = machine();
    await firewallRun("load", m.deps, PATHS);
    m.table!.splice(3, 1, { text: "ip daddr @blocked_v4 accept", packets: 0 });
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: true, reason: "listing_changed" });
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: false, reason: null });
    expect(m.loads).toBe(2);
    expect(m.table!.some((r) => r.text === "ip daddr @blocked_v4 accept")).toBe(false);
  });

  it("reloads a missing table once", async () => {
    const m = machine();
    await firewallRun("load", m.deps, PATHS);
    m.table = null;
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: true, reason: "missing" });
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: false, reason: null });
    expect(m.loads).toBe(2);
  });

  it("reloads a new host address once, replacing the table rather than appending to it", async () => {
    const m = machine();
    await firewallRun("load", m.deps, PATHS);
    const rules = m.table!.length;
    m.addresses = ["203.0.113.50", "203.0.113.51"];
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: true, reason: "file_changed" });
    expect(await firewallRun("check", m.deps, PATHS)).toEqual({ reloaded: false, reason: null });
    expect(m.loads).toBe(2);
    expect(m.table!.length).toBe(rules);
    expect(m.files.get(PATHS.file)).toContain("203.0.113.51");
  });

  it("reloads when the saved listing is gone (a reboot clears /run), and the table is then checked again by meaning", async () => {
    const m = machine();
    await firewallRun("load", m.deps, PATHS);
    m.files.delete("/run/fw/firewall.loaded.json");
    expect((await firewallRun("check", m.deps, PATHS)).reason).toBe("unsaved");
    expect((await firewallRun("check", m.deps, PATHS)).reloaded).toBe(false);
  });
});

describe("its parts", () => {
  it("reads BROWSER_HOST_BLOCK, comma or space separated", () => {
    expect(blockFrom('X=1\nBROWSER_HOST_BLOCK="172.236.169.129, 198.51.100.4"\n')).toEqual(["172.236.169.129", "198.51.100.4"]);
    expect(blockFrom(null)).toEqual([]);
  });

  it("names why it reloads", () => {
    expect(reloadReason({ hash: "a", savedHash: "a\n", meaning: "m", saved: "m" })).toBeNull();
    expect(reloadReason({ hash: "a", savedHash: "a", meaning: null, saved: "m" })).toBe("missing");
    expect(reloadReason({ hash: "b", savedHash: "a", meaning: "m", saved: "m" })).toBe("file_changed");
    expect(reloadReason({ hash: "a", savedHash: "a", meaning: "n", saved: "m" })).toBe("listing_changed");
  });
});
