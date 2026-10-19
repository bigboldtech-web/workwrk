// The server's install, read as text (docs/plans/browser-host.md 8.2 to
// 8.4 and Step 3): its guards and settings, the units' hardening and OOM
// scores, the timers, and the Caddyfile. Nothing here runs the script.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(HERE, f), "utf8");
const install = read("install.sh");
/** A unit's directives, without comments. */
const directives = (f: string) =>
  read(f)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
/** The body of one shell function of install.sh. */
const fn = (name: string) => {
  const at = install.indexOf(`\n${name}() {`);
  expect(at).toBeGreaterThan(0);
  return install.slice(at, install.indexOf("\n}\n", at) + 3);
};

describe("install.sh", () => {
  it("refuses anything but Ubuntu 24.04 on x86_64 with 30 GB free, first, in both modes", () => {
    const refuse = fn("step_refuse");
    expect(refuse).toContain('[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || stop');
    expect(refuse).toContain('[ "$(uname -m)" = "x86_64" ] || stop');
    expect(refuse).toContain('[ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || stop');
    expect(install).toContain("MIN_FREE_GB=30");
    // Decision 2: never beside the database or the app.
    expect(refuse).toContain("sport = :5432 or sport = :5433 or sport = :3000");
    expect(refuse).toContain("pgrep -x postgres");
    expect(refuse).toContain("pgrep -f '^next-server'");
    const main = install.slice(install.lastIndexOf("\nread_inputs\n"));
    const branches = main.split(/\nelse\n/);
    expect(branches).toHaveLength(2);
    for (const b of branches) expect(b.split("\n").map((l) => l.trim()).filter((l) => /^(step_|switch_|install_units|render_|write_|"\$OPT)/.test(l))[0]).toBe("step_refuse");
  });

  it("turns SSH passwords off only after checking the sudo user has a key", () => {
    const ssh = fn("step_ssh");
    const check = ssh.indexOf('if [ -s "$keys" ] && grep -Eq');
    const write = ssh.indexOf("/etc/ssh/sshd_config.d/10-workwrk.conf");
    expect(check).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(check);
    expect(ssh.indexOf("else", write)).toBeGreaterThan(write);
    expect(ssh.slice(ssh.indexOf("else", write))).toContain("stop");
    expect(ssh.indexOf("sshd -t")).toBeGreaterThan(write);
    expect(directives("sshd-workwrk.conf")).toEqual(["PasswordAuthentication no", "KbdInteractiveAuthentication no"]);
  });

  it("installs unattended upgrades for Ubuntu's security pocket, with no automatic reboot, and never Docker, containerd, Caddy or Node", () => {
    const os = fn("step_os");
    expect(os).toContain("unattended-upgrades");
    expect(os).toContain("/etc/apt/apt.conf.d/52workwrk-unattended-upgrades");
    const conf = read("52workwrk-unattended-upgrades");
    expect(conf).toContain('Unattended-Upgrade::Automatic-Reboot "false";');
    expect(conf).toContain('"${distro_id}:${distro_codename}-security";');
    for (const p of ["docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "caddy", "nodejs"]) expect(conf).toContain(`\t"${p}";`);
    expect(read("20auto-upgrades")).toContain('APT::Periodic::Unattended-Upgrade "1";');
    // A library update never restarts Docker or our units mid-day (needrestart restarts by itself on 24.04).
    const nr = read("needrestart-workwrk.conf");
    for (const u of ["docker", "containerd", "workwrk-browser", "caddy"]) expect(nr).toContain(`$nrconf{override_rc}->{qr(^${u})} = 0;`);
    expect(os).toContain("timedatectl show -p NTPSynchronized --value");
    expect(directives("journald-workwrk.conf")).toEqual(["[Journal]", "SystemMaxUse=200M", "MaxRetentionSec=14day"]);
  });

  it("never puts wkbhost in the docker group, and puts wkblaunch there", () => {
    const adds = [...install.matchAll(/usermod -aG docker (\S+)/g)].map((m) => m[1]);
    expect(adds).toEqual(["wkblaunch"]);
    const users = fn("step_users");
    expect(users).toContain("if in_group wkbhost docker; then gpasswd -d wkbhost docker; fi");
    expect(users).toContain('if in_group wkbhost docker; then stop "wkbhost is in the docker group"; fi');
    expect(users).toContain("getent passwd 10001");
    expect(directives("workwrk-browser-host.service").some((l) => l.startsWith("SupplementaryGroups"))).toBe(false);
    expect(directives("workwrk-browser-launcher.service")).toContain("SupplementaryGroups=docker");
  });

  it("holds every package to its major, and stops below the runc floor", () => {
    expect(install).toContain('pin docker-ce "5:${DOCKER_MAJOR}.*"');
    expect(install).toContain('pin nodejs "${NODE_MAJOR}.*"');
    for (const p of ["containerd.io", "docker-buildx-plugin", "caddy"]) expect(install).toContain(`pin ${p} "$(major_of ${p}).*"`);
    expect(fn("pin")).toContain("/etc/apt/preferences.d/workwrk-$1.pref");
    expect(install).toContain("RUNC_FLOOR=1.3.3");
    expect(fn("step_docker")).toContain('version_at_least "${runc_v:-0}" "$RUNC_FLOOR" || stop');
    // Every repository's key is checked by its fingerprint before it is trusted.
    for (const k of ["DOCKER_KEY_FPR", "NODESOURCE_KEY_FPR", "CADDY_KEY_FPR"]) expect(install).toMatch(new RegExp(`key_ok \\S+ "\\$${k}" \\|\\| stop`));
  });

  it("writes Docker's daemon.json of 8.2", () => {
    expect(JSON.parse(read("daemon.json"))).toEqual({ ipv6: false, icc: false, "userland-proxy": false, "live-restore": false, "no-new-privileges": true, "log-driver": "none", "default-address-pools": [{ base: "172.30.0.0/16", size: 24 }] });
    expect(fn("step_docker").indexOf("/etc/docker/daemon.json")).toBeLessThan(fn("step_docker").indexOf("apt-get install -y -q docker-ce"));
  });

  it("runs nft only through firewall-check.sh, which checks with nft -c before every load", () => {
    expect(install).not.toMatch(/\bnft\s+(-[a-z]+\s+)*-f\b/);
    expect(fn("step_firewall")).toContain('"$OPT/current/install/firewall-check.sh" load');
    const checker = read("firewall-check.mjs");
    const load = checker.slice(checker.indexOf("async function load("));
    expect(load.indexOf('["-c", "-f", paths.file]')).toBeGreaterThan(0);
    expect(load.indexOf('["-c", "-f", paths.file]')).toBeLessThan(load.indexOf('["-f", paths.file]'));
    const fw = directives("workwrk-browser-firewall.service");
    expect(fw).toContain("Before=docker.service");
    expect(fw).toContain("RequiredBy=docker.service");
    expect(fw).toContain("ExecStart=/opt/workwrk-browser-host/current/install/firewall-check.sh load");
  });

  it("keeps only the key's hash, in host.env 0640 root:wkbhost, and copies no proof or test to the server", () => {
    const env = fn("step_env");
    expect(env).toContain("BROWSER_HOST_KEY_SHA256=$hash");
    expect(install).not.toMatch(/BROWSER_HOST_KEY=/);
    expect(env).toContain('chown root:wkbhost "$ETC/host.env"');
    expect(env).toContain('chmod 0640 "$ETC/host.env"');
    expect(fn("step_print")).toContain("read -rs key");
    const code = fn("step_code");
    expect(code).toContain("--exclude=./proof");
    expect(code).toContain("--exclude='*.test.ts'");
    expect(code).toContain("npm ci --omit=dev --ignore-scripts");
  });

  it("drains through the admin socket before an update switches the code", () => {
    const update = install.slice(install.lastIndexOf("\nelse\n"));
    expect(update.indexOf('"$OPT/$SHA/install/maint.sh" drain-wait')).toBeGreaterThan(0);
    expect(update.indexOf("drain-wait")).toBeLessThan(update.indexOf("switch_current"));
  });

  it("says nothing with an em dash, an en dash or a double hyphen", () => {
    const copy = [...install.matchAll(/\b(?:say|stop) "([^"]*)"/g)].map((m) => m[1]);
    expect(copy.length).toBeGreaterThan(15);
    // A command's output and a flag's own name are code, not copy.
    const prose = (c: string) => c.replace(/\$\([^)]*\)/g, "").replace(/(^|\s)--[a-z][a-z-]*\b/g, "$1");
    for (const c of copy) expect({ c, bad: /[\u2013\u2014]|--/.test(prose(c)) }).toEqual({ c, bad: false });
  });
});

describe("the units", () => {
  const HOST_HARDENING = [
    "User=wkbhost",
    "Group=wkbhost",
    "Environment=NODE_ENV=production",
    "ExecStartPre=+/opt/workwrk-browser-host/current/install/firewall-check.sh",
    "TimeoutStopSec=30",
    "KillMode=mixed",
    "OOMScoreAdjust=-900",
    "StateDirectoryMode=0700",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "PrivateTmp=yes",
    "PrivateDevices=yes",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectControlGroups=yes",
    "RestrictSUIDSGID=yes",
    "RestrictNamespaces=yes",
    "LockPersonality=yes",
    "CapabilityBoundingSet=",
    "AmbientCapabilities=",
    "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    "SystemCallArchitectures=native",
    "MemoryMax=512M",
    "TasksMax=256",
  ];

  it("the host's carry every hardening line of 8.3, with no netlink", () => {
    const host = directives("workwrk-browser-host.service");
    for (const l of HOST_HARDENING) expect({ l, has: host.includes(l) }).toEqual({ l, has: true });
    expect(host.join("\n")).not.toContain("AF_NETLINK");
  });

  it("the launcher's has no network at all, the same hardening, and the host's OOM score", () => {
    const l = directives("workwrk-browser-launcher.service");
    for (const d of ["User=wkblaunch", "Group=wkblaunch", "PrivateNetwork=yes", "RestrictAddressFamilies=AF_UNIX", "IPAddressDeny=any", "OOMScoreAdjust=-900", "MemoryMax=256M", "ReadOnlyPaths=/etc/workwrk-browser-host", "Requires=docker.service workwrk-browser-launcher.socket"]) {
      expect({ d, has: l.includes(d) }).toEqual({ d, has: true });
    }
    for (const d of HOST_HARDENING.filter((x) => /^(NoNewPrivileges|ProtectSystem|ProtectHome|PrivateTmp|PrivateDevices|ProtectKernel|ProtectControl|RestrictSUID|RestrictNamespaces|LockPersonality|CapabilityBoundingSet|AmbientCapabilities|SystemCallArchitectures)/.test(x))) {
      expect({ d, has: l.includes(d) }).toEqual({ d, has: true });
    }
    expect(directives("workwrk-browser-launcher.socket")).toEqual(expect.arrayContaining(["ListenStream=/run/workwrk-browser-launcher/launcher.sock", "SocketUser=wkblaunch", "SocketGroup=wkbhost", "SocketMode=0660"]));
  });

  it("Caddy runs at OOM score -900 too", () => {
    expect(directives("caddy-workwrk.conf")).toEqual(["[Service]", "OOMScoreAdjust=-900"]);
    expect(fn("step_caddy")).toContain("/etc/systemd/system/caddy.service.d/workwrk.conf");
  });

  it("the timers run the firewall check every 5 minutes and the maintenance daily at 04:30", () => {
    expect(directives("workwrk-browser-firewall-check.timer")).toContain("OnCalendar=*:0/5");
    const maint = directives("workwrk-browser-maint.timer");
    expect(maint).toContain("OnCalendar=*-*-* 04:30:00");
    expect(maint).toContain("Persistent=true");
    expect(directives("workwrk-browser-maint.service")).toContain("ExecStart=/opt/workwrk-browser-host/current/install/maint.sh");
    expect(directives("workwrk-browser-firewall-check.service")).toContain("ExecStart=/opt/workwrk-browser-host/current/install/firewall-check.sh check");
  });
});

describe("the Caddyfile", () => {
  const caddy = read("Caddyfile.template");
  const lines = caddy.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  it("turns the admin API off and keeps no access, error or proxy log", () => {
    expect(lines).toContain("admin off");
    expect(lines).toContain("level ERROR");
    expect(lines).toContain("exclude http.log.error http.handlers.reverse_proxy");
    // The only log is the global default logger: no log directive in the site.
    const site = caddy.slice(caddy.indexOf("{{HOST_NAME}} {"));
    expect(site.split("\n").some((l) => /^\s*log\b/.test(l))).toBe(false);
  });

  it("answers the API, the connect route and /health to the app's addresses only, and /live and /healthz to anyone", () => {
    expect(lines).toContain("@api path /v1/* /connect/* /health");
    expect(lines).toContain("@notapp not remote_ip {{APP_IPS}}");
    expect(lines).toContain("respond @notapp 404");
    expect(lines).toContain("handle /live/* {");
    expect(lines).toContain("handle /healthz {");
    expect(lines.filter((l) => l === "reverse_proxy 127.0.0.1:8789")).toHaveLength(3);
    expect(lines).toContain('Strict-Transport-Security "max-age=31536000"');
  });
});
