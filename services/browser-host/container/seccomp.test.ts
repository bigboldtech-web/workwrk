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

  it("allows socket only for its allowlist, every argument masked to the 32 bits the kernel reads", () => {
    const socket = rulesFor("socket");
    expect(socket).toHaveLength(4);
    expect(socket.some(unconditional)).toBe(false);
    for (const r of socket) {
      expect(r.action).toBe("SCMP_ACT_ALLOW");
      expect(r.names).toEqual(["socket"]);
      expect(r.includes).toBeUndefined();
      for (const a of r.args!) expect({ op: a.op, mask: a.value }).toEqual({ op: "SCMP_CMP_MASKED_EQ", mask: 0xffffffff });
    }
    const want = (a: Arg) => ({ index: a.index, equals: a.valueTwo });
    expect(socket.map((r) => r.args!.map(want))).toEqual([
      [{ index: 0, equals: 1 }],
      [{ index: 0, equals: 2 }],
      [{ index: 0, equals: 10 }],
      [
        { index: 0, equals: 16 },
        { index: 2, equals: 0 },
      ],
    ]);
    // One comparison an argument a rule: runc splits a rule holding two on one argument into an OR.
    for (const r of socket) expect(new Set(r.args!.map((a) => a.index)).size).toBe(r.args!.length);
  });

  it("never lets through a socket the kernel reads as NETLINK_NETFILTER, whatever the high bits say (libseccomp compares 64 bits)", () => {
    const socket = rulesFor("socket");
    /** libseccomp's view: each condition on the full 64 bit argument. */
    const cmp = (a: Arg, v: bigint) => {
      const value = BigInt(a.value);
      const two = BigInt(a.valueTwo ?? 0);
      if (a.op === "SCMP_CMP_MASKED_EQ") return (v & value) === two;
      if (a.op === "SCMP_CMP_EQ") return v === value;
      if (a.op === "SCMP_CMP_NE") return v !== value;
      if (a.op === "SCMP_CMP_LT") return v < value;
      throw new Error(a.op);
    };
    const allowed = (args: bigint[]) => socket.some((r) => r.args!.every((a) => cmp(a, args[a.index])));
    // BigInt() rather than literals: the project's target predates them.
    const n = (v: number) => BigInt(v);
    const LOW = n(0xffffffff);
    const low = (v: bigint) => v & LOW;
    const high = [n(0), n(1) << n(32), LOW << n(32), n(1) << n(63)];
    const families = [0, 1, 2, 10, 16, 17, 38, 40, 44].map(n);
    const protocols = [0, 6, 12, 15, 17].map(n);
    /** What the kernel opens: the low 32 bits of each. */
    const opened: Array<[bigint, bigint]> = [];
    for (const h1 of high) for (const f of families) for (const h2 of high) for (const p of protocols) {
      const args = [f | h1, n(3), p | h2];
      if (allowed(args)) opened.push([low(args[0]), low(args[2])]);
    }
    expect(opened.some(([f, p]) => f === n(16) && p === n(12))).toBe(false);
    expect(opened.some(([f]) => ![1, 2, 10, 16].map(n).includes(f))).toBe(false);
    expect(opened.some(([f, p]) => f === n(16) && p !== n(0))).toBe(false);
    // The review's own call: syscall(41, 16, 3, 0x10000000C).
    expect(allowed([n(16), n(3), n(0x10000000c)])).toBe(false);
    // And what Chrome needs still opens.
    for (const ok of [[1, 1, 0], [2, 1, 6], [2, 2, 17], [10, 1, 0], [16, 3, 0]]) expect(allowed(ok.map(n))).toBe(true);
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
