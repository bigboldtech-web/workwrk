// The browser containers' seccomp profile (docs/plans/browser-host.md 5.2
// and Step 3), read as the JSON it is: Docker's default action, the three
// calls Chrome's namespace sandbox needs, the netfilter netlink socket
// refused, and no forbidden call allowed but behind a capability.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

type Arg = { index: number; value: number; valueTwo?: number; op: string };
type Rule = { names: string[]; action: string; args?: Arg[]; includes?: { caps?: string[]; arches?: string[]; minKernel?: string }; excludes?: { caps?: string[] }; errnoRet?: number };
type Profile = { comment: string; defaultAction: string; defaultErrnoRet?: number; archMap: Array<{ architecture: string; subArchitectures: string[] | null }>; syscalls: Rule[] };

const profile = JSON.parse(fs.readFileSync(path.join(HERE, "chrome-seccomp.json"), "utf8")) as Profile;
const rulesFor = (name: string) => profile.syscalls.filter((r) => r.names.includes(name));
const unconditional = (r: Rule) => r.action === "SCMP_ACT_ALLOW" && !r.args?.length && !r.includes && !r.excludes;

const FORBIDDEN = ["mount", "umount2", "pivot_root", "bpf", "kexec_load", "kexec_file_load", "init_module", "finit_module", "delete_module", "open_by_handle_at", "keyctl", "add_key", "request_key", "userfaultfd", "perf_event_open", "swapon", "swapoff", "reboot", "acct"];

describe("the seccomp profile", () => {
  it("parses, its default action is ERRNO, and it names its base", () => {
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(profile.comment).toContain("moby profiles/seccomp/default.json");
    expect(profile.comment).toContain("DOCKER_MAJOR");
    expect(profile.syscalls.length).toBeGreaterThan(20);
    for (const r of profile.syscalls) expect(r.names.length).toBeGreaterThan(0);
  });

  it("allows clone, unshare and chroot with no argument filter", () => {
    for (const name of ["clone", "unshare", "chroot"]) expect({ name, ok: rulesFor(name).some(unconditional) }).toEqual({ name, ok: true });
  });

  it("allows socket only by its two argument rules: below AF_NETLINK, and AF_NETLINK but NETLINK_NETFILTER", () => {
    const socket = rulesFor("socket");
    expect(socket).toHaveLength(2);
    expect(socket.some(unconditional)).toBe(false);
    for (const r of socket) {
      expect(r.action).toBe("SCMP_ACT_ALLOW");
      expect(r.names).toEqual(["socket"]);
      expect(r.includes).toBeUndefined();
    }
    const strip = (a: Arg) => ({ index: a.index, value: a.value, op: a.op });
    expect(socket.map((r) => r.args!.map(strip))).toEqual([
      [{ index: 0, value: 16, op: "SCMP_CMP_LT" }],
      [
        { index: 0, value: 16, op: "SCMP_CMP_EQ" },
        { index: 2, value: 12, op: "SCMP_CMP_NE" },
      ],
    ]);
    // One comparison an argument a rule: runc splits a rule holding two on one argument into an OR.
    for (const r of socket) expect(new Set(r.args!.map((a) => a.index)).size).toBe(r.args!.length);
  });

  it("keeps clone3 at ENOSYS without a capability, and setns behind CAP_SYS_ADMIN", () => {
    const clone3 = rulesFor("clone3").filter((r) => !r.includes?.caps);
    expect(clone3).toEqual([{ names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38, excludes: { caps: ["CAP_SYS_ADMIN"] } }]);
    expect(rulesFor("setns").every((r) => r.includes?.caps?.length)).toBe(true);
  });

  it("allows no forbidden call without a capability gate", () => {
    const open: string[] = [];
    for (const name of FORBIDDEN) for (const r of rulesFor(name)) if (r.action === "SCMP_ACT_ALLOW" && !(r.includes?.caps?.length)) open.push(name);
    expect(open).toEqual([]);
    for (const name of ["kexec_load", "kexec_file_load", "pivot_root", "keyctl", "add_key", "request_key", "userfaultfd", "swapon", "swapoff"]) expect(rulesFor(name)).toEqual([]);
  });

  it("knows x86_64 alone, so no 32 bit call (socketcall among them) reaches past the socket rules", () => {
    expect(profile.archMap).toEqual([{ architecture: "SCMP_ARCH_X86_64", subArchitectures: [] }]);
  });

  it("names every call once in its unconditional list", () => {
    const main = profile.syscalls[0];
    expect(unconditional(main)).toBe(true);
    expect(new Set(main.names).size).toBe(main.names.length);
    expect(main.names).not.toContain("socket");
    expect(main.names).not.toContain("clone");
  });
});
