// The server's install, read as text (docs/plans/browser-host.md 8.2 to
// 8.4 and Step 3): its guards and settings, the units' hardening and OOM
// scores, the timers, and the Caddyfile. Nothing here runs the script.

import { execFileSync } from "node:child_process";
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

  it("turns SSH passwords off only after checking the sudo user has a key, and after sshd accepts the drop-in at a path of its own", () => {
    const ssh = fn("step_ssh");
    const check = ssh.indexOf('if ! { [ -s "$keys" ] && grep -Eq');
    const tested = ssh.indexOf('if ! sshd -t -f "$tmp/sshd_config"; then');
    const placed = ssh.indexOf('install -m 0644 "$tmp/10-workwrk.conf" /etc/ssh/sshd_config.d/10-workwrk.conf');
    expect(check).toBeGreaterThan(0);
    expect(ssh.slice(check, tested)).toContain("stop");
    // The candidate is written to the temporary folder, with the real config included after it, and tested there first.
    expect(ssh.indexOf('install -m 0644 "$PKG_DIR/install/sshd-workwrk.conf" "$tmp/10-workwrk.conf"')).toBeGreaterThan(check);
    expect(ssh).toContain(`printf 'Include %s\\nInclude /etc/ssh/sshd_config\\n' "$tmp/10-workwrk.conf" >"$tmp/sshd_config"`);
    expect(tested).toBeGreaterThan(check);
    expect(placed).toBeGreaterThan(tested);
    // Nothing but the tested file ever reaches sshd_config.d, and a whole config sshd still refuses takes it out again.
    expect(ssh.match(/\/etc\/ssh\/sshd_config\.d\/10-workwrk\.conf/g)).toHaveLength(2);
    expect(ssh.slice(placed)).toContain("rm -f /etc/ssh/sshd_config.d/10-workwrk.conf");
    expect(ssh.indexOf("systemctl reload ssh")).toBeGreaterThan(placed);
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
    expect(directives("journald-workwrk.conf")).toEqual(["[Journal]", "SystemMaxUse=200M", "MaxRetentionSec=14day", "MaxFileSec=1day", "ForwardToSyslog=no"]);
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
    for (const k of ["DOCKER_KEY_FPR", "NODESOURCE_KEY_FPR", "CADDY_KEY_FPR"]) expect(install).toMatch(new RegExp(`trusted_key https://\\S+ "\\$${k}" /etc/apt/keyrings/\\S+\\.gpg`));
  });

  it("trusts only the key with the expected fingerprint: imported apart, and that one key exported for apt", () => {
    const tk = fn("trusted_key");
    expect(tk).toContain('GNUPGHOME="$tmp" gpg --batch --quiet --import "$tmp/key.asc"');
    expect(tk).toContain('GNUPGHOME="$tmp" gpg --batch --export "$2" >"$tmp/one.gpg"');
    // One primary key in what apt gets, and it is the expected one.
    expect(tk).toContain(`grep -c '^pub:'`);
    expect(tk).toContain('[ "$n" != "1" ]');
    expect(tk).toContain('install -m 0644 "$tmp/one.gpg" "$3"');
    // The downloaded file itself never becomes a keyring apt trusts.
    expect(install).not.toMatch(/--dearmor/);
    expect(install).not.toContain("key_ok");
    expect(install).toContain("signed-by=/etc/apt/keyrings/docker.gpg");
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
    // The key reaches curl on its standard input, never in its arguments.
    expect(fn("step_print")).toContain(`printf 'header = "X-BB-API-Key: %s"\\n' "$key" | curl -s -m 10 --config - `);
    expect(install).not.toMatch(/curl[^\n]*-H "X-BB-API-Key/);
    const code = fn("step_code");
    expect(code).toContain("--exclude=./proof");
    expect(code).toContain("--exclude='*.test.ts'");
    expect(code).toContain("npm ci --omit=dev --ignore-scripts");
  });

  it("drains through the admin socket before an update switches the code", () => {
    const update = install.slice(install.lastIndexOf("\nelse\n"));
    expect(update.indexOf('"$OPT/$SHA/install/maint.sh" drain-wait || stop')).toBeGreaterThan(0);
    expect(update.indexOf("drain-wait")).toBeLessThan(update.indexOf("switch_current"));
  });

  it("bounds every log at 15 days: a new journal file a day, and rsyslog masked with what it wrote removed (final privacy review, M2)", () => {
    const j = directives("journald-workwrk.conf");
    // MaxRetentionSec removes whole files by their newest entry: without a day's file, an entry could stay a month.
    expect(j).toEqual(expect.arrayContaining(["MaxRetentionSec=14day", "MaxFileSec=1day", "ForwardToSyslog=no"]));
    const logs = fn("step_logs");
    expect(logs).toContain("systemctl disable --now rsyslog.service syslog.socket");
    expect(logs).toContain("systemctl mask rsyslog.service syslog.socket");
    for (const f of ["/var/log/syslog", "/var/log/kern.log", "/var/log/auth.log"]) expect(logs).toContain(`${f} ${f}.*`);
    expect(logs).toContain('! systemctl is-active --quiet rsyslog.service || stop');
    // No edit of rsyslog's own rotation, a conffile that would hold its security updates back.
    expect(install).not.toContain("/etc/logrotate.d/rsyslog");
  });

  it("turns swap off for good and leaves no core dump (final privacy review, M3)", () => {
    const swap = fn("step_swap");
    expect(swap).toContain("swapoff -a");
    expect(swap).toContain(`awk '!/^[[:space:]]*#/ && $3 == "swap" { print "# workwrk: swap is off on the browser server: " $0; next } { print }' /etc/fstab >/etc/fstab.workwrk`);
    expect(swap).toContain('[ -z "$(swapon --show --noheadings)" ] || stop');
    // The swap files fstab named are read before its lines are commented out, and removed after swapoff.
    expect(swap.indexOf("files=$(awk")).toBeLessThan(swap.indexOf("swapoff -a"));
    expect(swap.indexOf("swapoff -a")).toBeLessThan(swap.indexOf('rm -f "$f"'));
    const cores = fn("step_cores");
    expect(cores).toContain("systemctl mask apport.service apport-forward.socket");
    expect(cores).toContain("sed -i -E 's/^enabled=.*/enabled=0/' /etc/default/apport");
    expect(cores).toContain('install -m 0644 "$PKG_DIR/install/sysctl-workwrk.conf" /etc/sysctl.d/60-workwrk-core.conf');
    expect(cores).toContain('[ "$(cat /proc/sys/kernel/core_pattern)" = "|/bin/false" ] || stop');
    expect(directives("sysctl-workwrk.conf")).toEqual(["kernel.core_pattern=|/bin/false", "fs.suid_dumpable=0"]);
    // The host, the launcher and Caddy: never swapped, never dumped.
    for (const u of ["workwrk-browser-host.service", "workwrk-browser-launcher.service", "caddy-workwrk.conf"]) {
      expect({ u, has: directives(u).filter((l) => l === "MemorySwapMax=0" || l === "LimitCORE=0") }).toEqual({ u, has: ["MemorySwapMax=0", "LimitCORE=0"] });
    }
  });

  it("runs the privacy steps on an install and on every update, the update before it drains", () => {
    const priv = fn("step_private");
    for (const step of ["journald-workwrk.conf", "step_logs", "step_swap", "step_cores"]) expect(priv).toContain(step);
    expect(fn("step_os")).toContain("step_private");
    const update = install.slice(install.lastIndexOf("\nelse\n"));
    expect(update.indexOf("step_private")).toBeGreaterThan(0);
    expect(update.indexOf("step_private")).toBeLessThan(update.indexOf("drain-wait"));
    // Caddy's drop-in is put in place by an update too, before Caddy restarts.
    expect(update.indexOf("install_caddy_dropin")).toBeLessThan(update.indexOf("render_caddyfile"));
  });

  it("refuses a BROWSER_HOST_APP_IPS range wider than a /24 or a /64 (final security review, L7)", () => {
    const check = (ip: string) => {
      try {
        execFileSync("bash", ["-c", `${fn("app_ip_ok")}\napp_ip_ok "$1"`, "check", ip], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    for (const ip of ["203.0.113.9", "203.0.113.0/24", "203.0.113.8/29", "203.0.113.9/32", "2001:db8::1", "2001:db8:1:2::/64", "2001:db8::1/128"]) expect({ ip, ok: check(ip) }).toEqual({ ip, ok: true });
    for (const ip of ["0.0.0.0/0", "10.0.0.0/8", "203.0.112.0/23", "::/0", "2001:db8::/32", "2001:db8::/63", "1.2.3.4/33", "not-an-ip", "1.2.3.4/x"]) expect({ ip, ok: check(ip) }).toEqual({ ip, ok: false });
    expect(fn("read_inputs")).toContain('app_ip_ok "$ip" || stop');
  });

  it("undrains on the way out when an update stops after its drain, and clears that once the host restarted", () => {
    const update = install.slice(install.lastIndexOf("\nelse\n"));
    const drained = update.indexOf('"$OPT/$SHA/install/maint.sh" drain-wait || stop');
    const trap = update.indexOf(`trap '"$OPT/$SHA/install/maint.sh" undrain >/dev/null 2>&1 || true' EXIT`);
    const restart = update.indexOf("systemctl restart workwrk-browser-launcher.service workwrk-browser-host.service");
    const cleared = update.indexOf("trap - EXIT");
    expect(drained).toBeGreaterThan(0);
    expect(trap).toBeGreaterThan(drained);
    expect(trap).toBeLessThan(update.indexOf("switch_current"));
    expect(cleared).toBeGreaterThan(restart);
    expect(read("maint.mjs")).toContain('what === "undrain"');
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
    "MemorySwapMax=0",
    "LimitCORE=0",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost 10.250.0.0/16",
    "RuntimeDirectory=workwrk-browser-host",
    "RuntimeDirectoryMode=0700",
    "RuntimeDirectoryPreserve=restart",
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

  it("the host's start runs the firewall check in its own root unit, with no privileged step of its own", () => {
    const host = directives("workwrk-browser-host.service");
    expect(host.some((l) => l.startsWith("ExecStartPre"))).toBe(false);
    expect(host).toContain("Wants=workwrk-browser-firewall-check.service");
    expect(host.find((l) => l.startsWith("After="))).toContain("workwrk-browser-firewall-check.service");
  });

  it("the root firewall units are sandboxed, writing only their own root-owned runtime folder", () => {
    for (const u of ["workwrk-browser-firewall.service", "workwrk-browser-firewall-check.service"]) {
      const d = directives(u);
      for (const l of ["ProtectSystem=strict", "ProtectHome=yes", "PrivateTmp=yes", "NoNewPrivileges=yes", "RuntimeDirectory=workwrk-browser-firewall", "RuntimeDirectoryMode=0755", "RuntimeDirectoryPreserve=yes"]) {
        expect({ u, l, has: d.includes(l) }).toEqual({ u, l, has: true });
      }
      expect(d.some((l) => /^(User|ReadWritePaths)=/.test(l))).toBe(false);
    }
    const m = directives("workwrk-browser-maint.service");
    expect(m).toEqual(expect.arrayContaining(["StateDirectory=workwrk-browser-maint", "StateDirectoryMode=0755", "ProtectHome=yes", "PrivateTmp=yes"]));
  });

  it("Caddy runs at OOM score -900 too", () => {
    expect(directives("caddy-workwrk.conf")).toEqual(["[Service]", "OOMScoreAdjust=-900", "MemorySwapMax=0", "LimitCORE=0"]);
    expect(fn("step_caddy")).toContain("install_caddy_dropin");
    expect(fn("install_caddy_dropin")).toContain("/etc/systemd/system/caddy.service.d/workwrk.conf");
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
  });

  it("sends no Strict-Transport-Security, so nothing is kept in a person's browser (final privacy review)", () => {
    expect(lines.some((l) => /Strict-Transport-Security/i.test(l))).toBe(false);
    expect(lines).toContain("-Server");
  });
});
