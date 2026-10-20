// @ts-check
// Every Docker Engine body the launcher sends (docs/plans/browser-host.md
// 5.2 and 5.5, Decision 19): built here, from constants and three checked
// arguments only (the session id, the viewport and the timeout). Nothing a
// caller sends reaches a body any other way; launcher.test.ts holds every
// field to 5.2. Pure.
//
// A session is one network and one container, both named wkb-<id8> and both
// labelled with the session: id8 is the first 8 hex characters of the session
// id, and when that name is in use the next 8 are taken. The bridge carries
// the same name, which is what the firewall matches (wkb-*).
//
// THE PROBES (5.2): three fixed commands the self-test runs in the image
// under test, with no network, under the same profiles as a session. Each
// must exit 0, which it does only when refused with EPERM (anything else
// refusing it, or another errno, is exit 3, a failure; step 3 review, L4):
//   netlink      the netfilter netlink socket (seccomp);
//   netlinkHigh  the same socket with a high bit set in its protocol, which
//                the kernel ignores and a 64 bit comparison would not (M1);
//   netAdmin     net_admin over a network namespace of its own (AppArmor).
// The ifreq netAdmin passes is padded to the kernel's 40 bytes.

import { chromeArgs } from "../lib/chrome-args.mjs";
import { CONTAINER_DNS } from "../lib/ranges.mjs";

/** The image's repository and the two tags a session may name. */
export const IMAGE_REPO = "workwrk-chrome";
export const IMAGE_TAGS = Object.freeze(["current", "candidate"]);

/** The labels every object the launcher makes carries (6.4: the reaper finds them by label). */
export const LABEL_BROWSER = "workwrk.browser";
export const LABEL_SESSION = "workwrk.session";
export const LABEL_PROBE = "workwrk.probe";
/** The label every image the launcher builds carries, so promote finds old ones, untagged too. */
export const LABEL_IMAGE = "workwrk.browser.image";

/** A session id, as lib/sessions.mjs makes them (crypto.randomUUID). */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The self-test's reserved session id: never a real session's (start refuses it). */
export const SELFTEST_SESSION = "00000000-0000-4000-8000-000000000000";

/** The container's own backstop past the host's timeout (6.1). */
export const BACKSTOP_SECONDS = 60;
/** Chrome's profile, on the home tmpfs. */
export const PROFILE_DIR = "/home/chrome/profile";
/** The self-test's own browser: the app's viewport, two minutes. */
export const SELFTEST_ASK = Object.freeze({ viewport: Object.freeze({ width: 1280, height: 800 }), timeoutSeconds: 120 });
/** How long a probe may run before its own timeout kills it. */
export const PROBE_SECONDS = 20;

/** The probe commands, after the image's `timeout -s KILL` entrypoint. */
export const PROBES = Object.freeze({
  netlink: Object.freeze(["/usr/bin/perl", "-e", "socket(my $s,16,3,12) ? exit 1 : ($!{EPERM} ? exit 0 : exit 3)"]),
  netlinkHigh: Object.freeze(["/usr/bin/perl", "-e", "syscall(41,16,3,4294967308) >= 0 ? exit 1 : ($!{EPERM} ? exit 0 : exit 3)"]),
  netAdmin: Object.freeze(["/usr/bin/unshare", "-Urn", "/usr/bin/perl", "-e", 'socket(S,2,2,0) or exit 2; ioctl(S,0x8914,pack("a16s x22","lo",1)) ? exit 1 : ($!{EPERM} ? exit 0 : exit 3)']),
});
/** The probes, in the order the self-test runs them. */
export const PROBE_NAMES = Object.freeze(/** @type {const} */ (["netlink", "netlinkHigh", "netAdmin"]));

/** The image's start: socat on the container's 9222 to Chrome on 127.0.0.1:9223, then Chrome (container/wkb-start). */
export const START = "/usr/local/bin/wkb-start";

const MIB = 1024 * 1024;

/**
 * The names a session's network and container may take, in order.
 * @param {string} session
 */
export function nameCandidates(session) {
  const hex = session.replace(/-/g, "");
  return [0, 8, 16, 24].map((at) => `wkb-${hex.slice(at, at + 8)}`);
}

/**
 * The session network (5.2).
 * @param {string} name wkb-<id8>
 * @param {{ subnet: string, gateway: string }} net
 * @param {string} session
 */
export function networkCreateBody(name, net, session) {
  return {
    Name: name,
    Driver: "bridge",
    CheckDuplicate: true,
    Internal: false,
    Attachable: false,
    EnableIPv6: false,
    IPAM: { Driver: "default", Config: [{ Subnet: net.subnet, Gateway: net.gateway }] },
    Options: {
      "com.docker.network.bridge.name": name,
      "com.docker.network.bridge.enable_icc": "false",
      "com.docker.network.bridge.enable_ip_masquerade": "true",
    },
    Labels: { [LABEL_BROWSER]: "1", [LABEL_SESSION]: session },
  };
}

/**
 * The hardening every container the launcher makes shares (5.2).
 * @param {{ memoryMb: number, seccomp: string, pids: number }} o
 */
function hardened(o) {
  return {
    ReadonlyRootfs: true,
    Privileged: false,
    CapDrop: ["ALL"],
    CapAdd: null,
    SecurityOpt: ["no-new-privileges:true", `seccomp=${o.seccomp}`, "apparmor=workwrk-browser"],
    Memory: o.memoryMb * MIB,
    MemorySwap: o.memoryMb * MIB,
    OomKillDisable: false,
    OomScoreAdj: 500,
    NanoCpus: 1_000_000_000,
    PidsLimit: o.pids,
    Ulimits: [
      { Name: "nofile", Soft: 4096, Hard: 4096 },
      { Name: "core", Soft: 0, Hard: 0 },
    ],
    LogConfig: { Type: "none" },
    Init: false,
    IpcMode: "private",
    CgroupnsMode: "private",
    PortBindings: {},
    PublishAllPorts: false,
    Binds: [],
    Mounts: [],
    Devices: [],
  };
}

/**
 * A session's container (5.2): the launcher's own function, from the session id, the viewport and the timeout.
 * @param {string} session
 * @param {{ width: number, height: number }} viewport
 * @param {number} timeoutSeconds
 * @param {{ name: string, ip: string }} net
 * @param {{ image: "current" | "candidate", memoryMb: number, seccomp: string }} fixed
 */
export function containerCreateBody(session, viewport, timeoutSeconds, net, fixed) {
  const flags = chromeArgs({ mode: "container", proof: false, viewport, profile: PROFILE_DIR });
  return {
    Image: `${IMAGE_REPO}:${fixed.image}`,
    User: "10001:10001",
    Cmd: [String(timeoutSeconds + BACKSTOP_SECONDS), START, ...flags, "about:blank"],
    Env: ["HOME=/home/chrome", "TZ=UTC", "LANG=C.UTF-8"],
    Labels: { [LABEL_BROWSER]: "1", [LABEL_SESSION]: session },
    StopTimeout: 5,
    HostConfig: {
      NetworkMode: net.name,
      ...hardened({ memoryMb: fixed.memoryMb, seccomp: fixed.seccomp, pids: 1024 }),
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,noexec,size=128m,mode=1777",
        "/home/chrome": "rw,nosuid,nodev,noexec,size=512m,uid=10001,gid=10001,mode=0700",
      },
      ShmSize: 268435456,
      Sysctls: { "net.ipv6.conf.all.disable_ipv6": "1", "net.ipv6.conf.default.disable_ipv6": "1" },
      Dns: [...CONTAINER_DNS],
      DnsSearch: [],
      DnsOptions: [],
      AutoRemove: true,
    },
    NetworkingConfig: { EndpointsConfig: { [net.name]: { IPAMConfig: { IPv4Address: net.ip } } } },
  };
}

/**
 * A probe's container: the image under test running one fixed probe, with no network and the session's profiles.
 * @param {"current" | "candidate"} image
 * @param {"netlink" | "netlinkHigh" | "netAdmin"} which
 * @param {{ seccomp: string }} fixed
 */
export function probeCreateBody(image, which, fixed) {
  return {
    Image: `${IMAGE_REPO}:${image}`,
    User: "10001:10001",
    Cmd: [String(PROBE_SECONDS), ...PROBES[which]],
    Env: ["HOME=/tmp", "TZ=UTC", "LANG=C.UTF-8"],
    Labels: { [LABEL_BROWSER]: "1", [LABEL_PROBE]: which },
    StopTimeout: 2,
    HostConfig: {
      NetworkMode: "none",
      ...hardened({ memoryMb: 256, seccomp: fixed.seccomp, pids: 64 }),
      Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=16m,mode=1777" },
      AutoRemove: false,
    },
  };
}
