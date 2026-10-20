// The browser containers' AppArmor profile (docs/plans/browser-host.md 5.2
// and Step 3): abi 4.0, userns and unix, docker-default's deny mount, and
// each capability denial of 5.2, with sys_admin and sys_chroot left allowed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(HERE, "apparmor-workwrk-browser"), "utf8");
/** The profile's rules, without comments or blank lines. */
const rules = text
  .split("\n")
  .map((l) => l.replace(/#.*$/, "").trim())
  .filter(Boolean);

const DENIED = ["net_admin", "net_raw", "sys_module", "bpf", "perfmon", "sys_rawio", "mknod", "syslog", "mac_admin", "mac_override", "sys_boot", "sys_time"];

describe("the AppArmor profile", () => {
  it("is workwrk-browser under abi 4.0", () => {
    expect(rules[0]).toBe("abi <abi/4.0>,");
    expect(rules).toContain("profile workwrk-browser flags=(attach_disconnected,mediate_deleted) {");
  });

  it("holds userns, unix and deny mount", () => {
    for (const r of ["userns,", "unix,", "deny mount,", "network,", "capability,", "file,"]) expect({ r, has: rules.includes(r) }).toEqual({ r, has: true });
  });

  it("denies each capability of 5.2", () => {
    for (const cap of DENIED) expect({ cap, has: rules.includes(`deny capability ${cap},`) }).toEqual({ cap, has: true });
    expect(rules.filter((r) => r.startsWith("deny capability"))).toHaveLength(DENIED.length);
  });

  it("leaves sys_admin and sys_chroot allowed, for Chrome's sandbox", () => {
    expect(rules.some((r) => /deny capability (sys_admin|sys_chroot)/.test(r))).toBe(false);
  });

  it("keeps docker-default's proc, sys and signal rules", () => {
    for (const r of ["deny @{PROC}/sysrq-trigger rwklx,", "deny @{PROC}/kcore rwklx,", "deny /sys/kernel/security/** rwklx,", "deny /sys/firmware/** rwklx,", "signal (send,receive) peer=workwrk-browser,", "ptrace (trace,read,tracedby,readby) peer=workwrk-browser,"]) {
      expect({ r, has: rules.includes(r) }).toEqual({ r, has: true });
    }
  });
});
