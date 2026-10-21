#!/usr/bin/env bash
# The WorkwrK browser server's install (docs/plans/browser-host.md 8.2):
# Ubuntu 24.04 on x86_64, run with sudo by the user you sign in with, from
# the `git archive <gated sha> services/browser-host` tarball, unpacked.
# Every step can run again safely.
#
#   sudo BROWSER_HOST_NAME=browsers.<domain> BROWSER_HOST_REGION=us-east-1 \
#        BROWSER_HOST_ACME_EMAIL=<address> BROWSER_HOST_APP_IPS=<app server IPs> \
#        ./install/install.sh
#   sudo ./install/install.sh --update        a new tarball: drained, switched, restarted
#
# BROWSER_HOST_APP_IPS are the only addresses that reach the API (Caddy);
# BROWSER_HOST_BLOCK (by default the IPv4 ones among them) are refused to
# every session (the firewall). BROWSER_HOST_APP_ORIGIN defaults to
# https://app.workwrk.com. The values are kept in install.env for --update.
#
# IN ORDER (the spec's, but Node.js and the code come before the firewall,
# whose writer is install/firewall-check.mjs):
#   1. refuse unless Ubuntu 24.04, x86_64, 30 GB free, and no Postgres or app here
#   2. the OS: unattended security upgrades with no reboot, NTP, journald as the
#      only log (rsyslog masked), no swap, no core dumps (apport masked), tools
#   3. SSH keys only, after checking the sudo user has one
#   4. Node.js from NodeSource's signed repository, held to its major
#   5. Docker Engine from Docker's signed repository, held to its major; the runc floor
#   6. the AppArmor and seccomp profiles
#   7. the users: wkbhost (never in docker) and wkblaunch (in docker); nothing is uid 10001
#   8. the code to /opt/workwrk-browser-host/<sha>, without the proofs or the tests
#   9. the firewall, checked with nft -c before it loads, and its 5-minute check
#  10. host.env, with the key's hash only (the key is printed once)
#  11. Caddy from its signed repository, the Caddyfile, OOM score -900
#  12. the units; the host builds the first image with a slot held and self-tests it
#  13. /health, with the key read from the terminal, and every version
set -euo pipefail
umask 022

PKG_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DOCKER_MAJOR=29
NODE_MAJOR=24
RUNC_FLOOR=1.3.3
MIN_FREE_GB=30
# verify: each fingerprint against its project's published key at install time.
DOCKER_KEY_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
NODESOURCE_KEY_FPR=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
CADDY_KEY_FPR=65760C51EDEA2017CEA2CA15155B6D79CA56EA34
ETC=/etc/workwrk-browser-host
OPT=/opt/workwrk-browser-host
STATE=/var/lib/workwrk-browser-host
MAINT_DIR=/var/lib/workwrk-browser-maint
UNITS=(workwrk-browser-firewall.service workwrk-browser-firewall-check.service workwrk-browser-firewall-check.timer
  workwrk-browser-launcher.socket workwrk-browser-launcher.service workwrk-browser-host.service
  workwrk-browser-maint.service workwrk-browser-maint.timer)
export DEBIAN_FRONTEND=noninteractive

say() { printf '%s\n' "$*"; }
stop() {
  printf 'install: %s\n' "$*" >&2
  exit 1
}
# A repository's signing key, by its full fingerprint and nothing else: the
# file is imported into a keyring of its own, and only the key with that
# fingerprint is exported into the keyring apt trusts. A file that holds the
# real key and another one beside it gives apt the real one alone.
#   trusted_key <url> <fingerprint> <keyring>
trusted_key() {
  local tmp n
  tmp=$(mktemp -d)
  if ! curl -fsSL "$1" -o "$tmp/key.asc"; then
    rm -rf "$tmp"
    stop "the signing key could not be downloaded from $1"
  fi
  GNUPGHOME="$tmp" gpg --batch --quiet --import "$tmp/key.asc" 2>/dev/null || true
  GNUPGHOME="$tmp" gpg --batch --export "$2" >"$tmp/one.gpg" 2>/dev/null || true
  n=$(gpg --show-keys --with-colons "$tmp/one.gpg" 2>/dev/null | grep -c '^pub:' || true)
  if [ ! -s "$tmp/one.gpg" ] || [ "$n" != "1" ] || [[ $'\n'"$(gpg --show-keys --with-colons "$tmp/one.gpg" 2>/dev/null)"$'\n' != *$'\n'"fpr:::::::::$2:"$'\n'* ]]; then
    rm -rf "$tmp"
    stop "the signing key $2 is not in $1"
  fi
  install -d -m 0755 "$(dirname "$3")"
  install -m 0644 "$tmp/one.gpg" "$3"
  rm -rf "$tmp"
}
# Whether a user is in a group.
in_group() { [[ " $(id -nG "$1") " == *" $2 "* ]]; }
# Whether one of BROWSER_HOST_APP_IPS is an address, or a range no wider than
# a /24 (IPv4) or a /64 (IPv6): the API and the connect address answer only
# these, so a wide range such as 0.0.0.0/0 would open them to anyone (final
# security review, L7).
app_ip_ok() {
  local ip=$1 prefix
  printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-fA-F:]{2,39})(/[0-9]{1,3})?$' || return 1
  case "$ip" in
    */*) prefix=$((10#${ip##*/})) ;;
    *) return 0 ;;
  esac
  case "$ip" in
    *.*) [ "$prefix" -ge 24 ] && [ "$prefix" -le 32 ] ;;
    *) [ "$prefix" -ge 64 ] && [ "$prefix" -le 128 ] ;;
  esac
}
# Whether version $1 is at least $2.
version_at_least() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
# A package's major, epoch kept ("5:29", "2", "24").
major_of() { dpkg-query -W -f='${Version}' "$1" | sed -E 's/^([0-9]+:)?([0-9]+)\..*/\1\2/'; }
# Hold a package to a version glob (each held to its major, 8.4).
pin() {
  cat >"/etc/apt/preferences.d/workwrk-$1.pref" <<EOF
Package: $1
Pin: version $2
Pin-Priority: 1001
EOF
}

MODE=install
case "${1:-}" in
  "") ;;
  --update) MODE=update ;;
  *) stop "unknown argument: use no argument, or --update" ;;
esac
[ "$(id -u)" -eq 0 ] || stop "run it with sudo"

read_inputs() {
  if [ -f "$ETC/install.env" ]; then
    # shellcheck disable=SC1091
    . "$ETC/install.env"
  fi
  : "${BROWSER_HOST_NAME:?set BROWSER_HOST_NAME, for example browsers.workwrkbrowsers.com}"
  : "${BROWSER_HOST_REGION:?set BROWSER_HOST_REGION, for example us-east-1}"
  : "${BROWSER_HOST_ACME_EMAIL:?set BROWSER_HOST_ACME_EMAIL, the address Let's Encrypt writes to}"
  : "${BROWSER_HOST_APP_IPS:?set BROWSER_HOST_APP_IPS, the app server's outgoing addresses}"
  printf '%s' "$BROWSER_HOST_NAME" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' || stop "BROWSER_HOST_NAME is not a host name"
  case "$BROWSER_HOST_NAME" in
    workwrk.com | *.workwrk.com) stop "the browser server's name is never under workwrk.com (Decision 2)" ;;
  esac
  printf '%s' "$BROWSER_HOST_REGION" | grep -Eq '^[a-z]{2}-[a-z]+-[0-9]$' || stop "BROWSER_HOST_REGION is not a region label like us-east-1"
  printf '%s' "$BROWSER_HOST_ACME_EMAIL" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || stop "BROWSER_HOST_ACME_EMAIL is not an email address"
  APP_IPS=$(printf '%s' "$BROWSER_HOST_APP_IPS" | tr ',' ' ' | xargs)
  [ -n "$APP_IPS" ] || stop "BROWSER_HOST_APP_IPS is empty"
  for ip in $APP_IPS; do
    app_ip_ok "$ip" || stop "BROWSER_HOST_APP_IPS holds $ip, which is not an address or a range no wider than a /24 (IPv4) or a /64 (IPv6)"
  done
  BLOCK="${BROWSER_HOST_BLOCK:-}"
  if [ -z "$BLOCK" ]; then
    for ip in $APP_IPS; do
      if [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then BLOCK="${BLOCK:+$BLOCK,}$ip"; fi
    done
  fi
  printf '%s' "$BLOCK" | grep -Eq '^[0-9./,]*$' || stop "BROWSER_HOST_BLOCK holds something that is not an IPv4 address"
  APP_ORIGIN="${BROWSER_HOST_APP_ORIGIN:-https://app.workwrk.com}"
  printf '%s' "$APP_ORIGIN" | grep -Eq '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' || stop "BROWSER_HOST_APP_ORIGIN is not an https origin"
}

save_inputs() {
  install -d -m 0755 "$ETC"
  cat >"$ETC/install.env" <<EOF
BROWSER_HOST_NAME=$BROWSER_HOST_NAME
BROWSER_HOST_REGION=$BROWSER_HOST_REGION
BROWSER_HOST_ACME_EMAIL=$BROWSER_HOST_ACME_EMAIL
BROWSER_HOST_APP_IPS="$APP_IPS"
BROWSER_HOST_BLOCK=$BLOCK
BROWSER_HOST_APP_ORIGIN=$APP_ORIGIN
EOF
  chmod 0644 "$ETC/install.env"
}

# 1. Refuse anything but the server this was written for, and any machine with the database or the app on it.
step_refuse() {
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || stop "Ubuntu 24.04 only"
  [ "$(uname -m)" = "x86_64" ] || stop "x86_64 only"
  free_gb=$(df -BG --output=avail / | tail -n1 | tr -dc '0-9')
  [ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || stop "at least ${MIN_FREE_GB} GB must be free on /"
  if [ -n "$(ss -Hltn '( sport = :5432 or sport = :5433 or sport = :3000 )')" ]; then stop "a Postgres or the app listens on this machine (Decision 2)"; fi
  if pgrep -x postgres >/dev/null || pgrep -f '^next-server' >/dev/null; then stop "a Postgres or the app runs on this machine (Decision 2)"; fi
  if command -v ufw >/dev/null && [[ $(ufw status) == *"Status: active"* ]]; then stop "ufw is on: this server's firewall is its own nftables table; turn ufw off first"; fi
}

# 2. The OS.
step_os() {
  apt-get update -q
  apt-get install -y -q --no-install-recommends unattended-upgrades dnsutils curl ca-certificates gnupg nftables apparmor apparmor-utils iproute2 needrestart python3
  install -m 0644 "$PKG_DIR/install/52workwrk-unattended-upgrades" /etc/apt/apt.conf.d/52workwrk-unattended-upgrades
  install -m 0644 "$PKG_DIR/install/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
  install -d -m 0755 /etc/needrestart/conf.d
  install -m 0644 "$PKG_DIR/install/needrestart-workwrk.conf" /etc/needrestart/conf.d/workwrk.conf
  # nftables.service would flush every table, ours and Docker's, if it ever ran.
  systemctl mask nftables.service >/dev/null 2>&1 || true
  timedatectl set-ntp true || true
  for _ in $(seq 1 30); do
    [ "$(timedatectl show -p NTPSynchronized --value)" = "yes" ] && break
    sleep 2
  done
  [ "$(timedatectl show -p NTPSynchronized --value)" = "yes" ] || stop "the clock is not synchronised (systemd-timesyncd)"
  step_private
}

# What keeps a person's browsing off the disk (final privacy review, M2 and
# M3): the journal's bounds, no other log, no swap and no core dumps. Run by
# an install and by every update alike.
step_private() {
  install -d -m 0755 /etc/systemd/journald.conf.d
  install -m 0644 "$PKG_DIR/install/journald-workwrk.conf" /etc/systemd/journald.conf.d/workwrk.conf
  systemctl restart systemd-journald
  step_logs
  step_swap
  step_cores
}

# The journal is the server's only log (final privacy review, M2), kept at
# most 15 days (journald-workwrk.conf). rsyslog would copy the kernel's and
# sshd's lines into /var/log for four weeks, so it is masked rather than
# rotated at 14 days: one store with one bound, and no edit of rsyslog's own
# logrotate file, a changed conffile that would hold back its security
# updates. What it already wrote goes too.
step_logs() {
  systemctl disable --now rsyslog.service syslog.socket >/dev/null 2>&1 || true
  systemctl mask rsyslog.service syslog.socket >/dev/null
  rm -f /var/log/syslog /var/log/syslog.* /var/log/kern.log /var/log/kern.log.* /var/log/auth.log /var/log/auth.log.* \
    /var/log/mail.log /var/log/mail.log.* /var/log/mail.err /var/log/mail.err.* /var/log/messages /var/log/messages.*
  ! systemctl is-active --quiet rsyslog.service || stop "rsyslog still runs after it was masked"
}

# No swap, ever (final privacy review, M3): a browser's memory holds what a
# person sees and types. Every swap area goes off, every swap line of fstab
# is commented out, and every swap file it named is removed. The host
# refuses to start a browser while /proc/swaps lists anything.
step_swap() {
  local files
  files=$(awk '!/^[[:space:]]*#/ && $3 == "swap" && $1 ~ /^\// { print $1 }' /etc/fstab)
  swapoff -a
  awk '!/^[[:space:]]*#/ && $3 == "swap" { print "# workwrk: swap is off on the browser server: " $0; next } { print }' /etc/fstab >/etc/fstab.workwrk
  cat /etc/fstab.workwrk >/etc/fstab
  rm -f /etc/fstab.workwrk
  systemctl daemon-reload
  for f in $files; do
    if [ -f "$f" ]; then rm -f "$f"; fi
  done
  [ -z "$(swapon --show --noheadings)" ] || stop "swap is still on after swapoff -a"
}

# No core dumps (final privacy review, M3): apport off and masked, and the
# kernel hands every dump to /bin/false (sysctl-workwrk.conf), for good.
step_cores() {
  if [ -f /etc/default/apport ]; then sed -i -E 's/^enabled=.*/enabled=0/' /etc/default/apport; fi
  systemctl disable --now apport.service apport-forward.socket >/dev/null 2>&1 || true
  systemctl mask apport.service apport-forward.socket >/dev/null
  install -d -m 0755 /etc/sysctl.d
  install -m 0644 "$PKG_DIR/install/sysctl-workwrk.conf" /etc/sysctl.d/60-workwrk-core.conf
  sysctl -q -p /etc/sysctl.d/60-workwrk-core.conf
  [ "$(cat /proc/sys/kernel/core_pattern)" = "|/bin/false" ] || stop "the kernel's core pattern is not |/bin/false"
}

# 3. SSH: keys only, and only once the sudo user has a key to sign in with.
step_ssh() {
  user="${SUDO_USER:-}"
  [ -n "$user" ] && [ "$user" != "root" ] || stop "run it with sudo as the user you sign in with"
  home=$(getent passwd "$user" | cut -d: -f6)
  keys="$home/.ssh/authorized_keys"
  if ! { [ -s "$keys" ] && grep -Eq '^(ssh-(ed25519|rsa)|ecdsa-sha2-|sk-)' -- "$keys"; }; then
    stop "no key in $keys: add one before password login is turned off"
  fi
  # Checked by sshd at a path of its own first, with the whole config after it; only then put in place.
  tmp=$(mktemp -d)
  install -m 0644 "$PKG_DIR/install/sshd-workwrk.conf" "$tmp/10-workwrk.conf"
  printf 'Include %s\nInclude /etc/ssh/sshd_config\n' "$tmp/10-workwrk.conf" >"$tmp/sshd_config"
  if ! sshd -t -f "$tmp/sshd_config"; then
    rm -rf "$tmp"
    stop "sshd refuses the keys only settings: nothing was changed"
  fi
  install -m 0644 "$tmp/10-workwrk.conf" /etc/ssh/sshd_config.d/10-workwrk.conf
  rm -rf "$tmp"
  if ! sshd -t; then
    rm -f /etc/ssh/sshd_config.d/10-workwrk.conf
    stop "sshd refuses its config with the keys only settings: they were taken out again"
  fi
  systemctl reload ssh
}

# 4. Node.js, held to its major.
step_node() {
  trusted_key https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "$NODESOURCE_KEY_FPR" /etc/apt/keyrings/nodesource.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  pin nodejs "${NODE_MAJOR}.*"
  apt-get update -q
  apt-get install -y -q nodejs
}

# 5. Docker Engine, held to its major, and the runc floor (8.5).
step_docker() {
  trusted_key https://download.docker.com/linux/ubuntu/gpg "$DOCKER_KEY_FPR" /etc/apt/keyrings/docker.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" >/etc/apt/sources.list.d/docker.list
  pin docker-ce "5:${DOCKER_MAJOR}.*"
  pin docker-ce-cli "5:${DOCKER_MAJOR}.*"
  install -d -m 0755 /etc/docker
  install -m 0644 "$PKG_DIR/install/daemon.json" /etc/docker/daemon.json
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  pin containerd.io "$(major_of containerd.io).*"
  pin docker-buildx-plugin "$(major_of docker-buildx-plugin).*"
  systemctl restart docker
  runc_v=$(runc --version | sed -n 's/^runc version \([0-9][0-9.]*\).*/\1/p')
  version_at_least "${runc_v:-0}" "$RUNC_FLOOR" || stop "runc ${runc_v:-unknown} is below the floor $RUNC_FLOOR"
}

# 6. The profiles every session container names.
step_profiles() {
  install -d -m 0755 "$ETC"
  install -m 0644 "$PKG_DIR/container/apparmor-workwrk-browser" /etc/apparmor.d/workwrk-browser
  apparmor_parser -r -W /etc/apparmor.d/workwrk-browser
  install -m 0644 "$PKG_DIR/container/chrome-seccomp.json" "$ETC/chrome-seccomp.json"
}

# 7. The users. Only the launcher's is in docker; uid 10001 is Chrome's inside the containers alone.
step_users() {
  getent group wkbhost >/dev/null || groupadd --system wkbhost
  getent passwd wkbhost >/dev/null || useradd --system --gid wkbhost --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin wkbhost
  getent group wkblaunch >/dev/null || groupadd --system wkblaunch
  getent passwd wkblaunch >/dev/null || useradd --system --gid wkblaunch --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin wkblaunch
  usermod -aG docker wkblaunch
  # The host's user never reaches Docker (Decision 19).
  if in_group wkbhost docker; then gpasswd -d wkbhost docker; fi
  if in_group wkbhost docker; then stop "wkbhost is in the docker group"; fi
  if getent passwd 10001 >/dev/null || getent group 10001 >/dev/null; then stop "uid or gid 10001 is taken on this server"; fi
  if [ -n "$(find / -xdev \( -uid 10001 -o -gid 10001 \) -print -quit 2>/dev/null || true)" ]; then stop "a file on this server is owned by uid or gid 10001"; fi
  install -d -o wkbhost -g wkbhost -m 0700 "$STATE"
  # Root's own folder for what the maintenance job writes for the host to read (H1).
  install -d -o root -g root -m 0755 "$MAINT_DIR"
}

# 8. The code, without the proofs or the tests, to its own folder.
step_code() {
  SHA=$(tr -dc '0-9a-f' <"$PKG_DIR/VERSION" || true)
  [ "${#SHA}" -ge 7 ] || stop "VERSION is missing: unpack the archive the gate made"
  dest="$OPT/$SHA"
  install -d -m 0755 "$OPT"
  rm -rf "$dest.tmp"
  install -d -m 0755 "$dest.tmp"
  tar -C "$PKG_DIR" --exclude=./proof --exclude='*.test.ts' --exclude=./forbidden-flags.ts --exclude=./node_modules -cf - . | tar -C "$dest.tmp" -xf -
  (cd "$dest.tmp" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
  chown -R root:root "$dest.tmp"
  chmod -R go-w "$dest.tmp"
  chmod 0755 "$dest.tmp"/install/*.sh
  rm -rf "$dest"
  mv "$dest.tmp" "$dest"
}
switch_current() {
  ln -sfn "$OPT/$SHA" "$OPT/current.tmp"
  mv -Tf "$OPT/current.tmp" "$OPT/current"
}

# 9. The firewall: written with wkbhost's uid, checked with nft -c, loaded (firewall-check.sh does all three).
step_firewall() {
  printf 'BROWSER_HOST_BLOCK=%s\n' "$BLOCK" >"$ETC/firewall.env"
  chmod 0644 "$ETC/firewall.env"
  "$OPT/current/install/firewall-check.sh" load
}

# 10. The host's environment: the key's hash only; the key is printed once.
step_env() {
  if [ -f "$ETC/host.env" ]; then
    say "host.env is kept, and with it the key"
    return
  fi
  key=$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
  hash=$(printf '%s' "$key" | sha256sum | cut -d' ' -f1)
  (
    umask 027
    cat >"$ETC/host.env" <<EOF
BROWSER_HOST_MODE=container
BROWSER_HOST_PORT=8789
BROWSER_HOST_PUBLIC_URL=https://$BROWSER_HOST_NAME
BROWSER_HOST_APP_ORIGIN=$APP_ORIGIN
BROWSER_HOST_KEY_SHA256=$hash
BROWSER_HOST_REGION=$BROWSER_HOST_REGION
BROWSER_HOST_SESSION_MEMORY_MB=1280
EOF
  )
  chown root:wkbhost "$ETC/host.env"
  chmod 0640 "$ETC/host.env"
  say "The key for the app's BROWSER_HOST_KEY. It is shown this once and kept nowhere on this server:"
  say "$key"
  unset key
}

# 11. Caddy, its Caddyfile, and its OOM score.
step_caddy() {
  trusted_key https://dl.cloudsmith.io/public/caddy/stable/gpg.key "$CADDY_KEY_FPR" /etc/apt/keyrings/caddy-stable.gpg
  echo "deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
  pin caddy "$(major_of caddy).*"
  install_caddy_dropin
  render_caddyfile
}
install_caddy_dropin() {
  install -d -m 0755 /etc/systemd/system/caddy.service.d
  install -m 0644 "$OPT/current/install/caddy-workwrk.conf" /etc/systemd/system/caddy.service.d/workwrk.conf
}
render_caddyfile() {
  sed -e "s|{{HOST_NAME}}|$BROWSER_HOST_NAME|g" -e "s|{{ACME_EMAIL}}|$BROWSER_HOST_ACME_EMAIL|g" -e "s|{{APP_IPS}}|$APP_IPS|g" \
    "$OPT/current/install/Caddyfile.template" >/etc/caddy/Caddyfile.new
  caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.new >/dev/null
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  systemctl daemon-reload
  systemctl restart caddy
}

# 12. The units. The host builds the first image itself, with a slot held, and self-tests it.
install_units() {
  for u in "${UNITS[@]}"; do install -m 0644 "$OPT/current/install/$u" "/etc/systemd/system/$u"; done
  systemctl daemon-reload
}
step_units() {
  install_units
  systemctl enable workwrk-browser-firewall.service
  systemctl enable --now workwrk-browser-firewall-check.timer workwrk-browser-maint.timer workwrk-browser-launcher.socket
  systemctl enable --now workwrk-browser-launcher.service workwrk-browser-host.service
}

# versions.json, by the maintenance job's own safe writer, into the folder root owns (H1).
write_versions() {
  "$OPT/current/install/maint.sh" versions
}

# 13. /health, with the key read from the terminal (never a file), and every version.
step_print() {
  say "Waiting for the browser image and its self-test (the first build takes some minutes)"
  for _ in $(seq 1 180); do
    [ "$(curl -s -m 5 http://127.0.0.1:8789/healthz || true)" = "ok" ] && break
    sleep 10
  done
  say "Paste the key to read /health (it is not stored):"
  read -rs key
  # The header goes to curl on its standard input, never in its arguments, where ps would show it.
  printf 'header = "X-BB-API-Key: %s"\n' "$key" | curl -s -m 10 --config - http://127.0.0.1:8789/health | python3 -m json.tool
  unset key
  say "docker $(docker version -f '{{.Server.Version}}'), $(runc --version | sed -n 1p), caddy $(caddy version | cut -d' ' -f1), node $(node --version), kernel $(uname -r)"
}

read_inputs
if [ "$MODE" = install ]; then
  step_refuse
  save_inputs
  step_os
  step_ssh
  step_node
  step_docker
  step_profiles
  step_users
  step_code
  switch_current
  step_firewall
  step_env
  step_caddy
  write_versions
  step_units
  step_print
else
  # An update of the host's own code: drained, switched, restarted (8.2).
  step_refuse
  step_private
  step_code
  # A running host must answer the drain, or nothing is switched; a stopped one has nothing running.
  if systemctl is-active --quiet workwrk-browser-host.service; then
    "$OPT/$SHA/install/maint.sh" drain-wait || stop "the host did not answer the drain: nothing was switched"
    # A step below that stops the update undrains the host on the way out (final contract review, M3).
    trap '"$OPT/$SHA/install/maint.sh" undrain >/dev/null 2>&1 || true' EXIT
  fi
  switch_current
  step_profiles
  install_units
  step_firewall
  install_caddy_dropin
  render_caddyfile
  systemctl restart workwrk-browser-launcher.service workwrk-browser-host.service
  # Restarted, so undrained.
  trap - EXIT
  write_versions
  step_print
fi
