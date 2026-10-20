#!/bin/sh
# The browser host's firewall, loaded and checked as root
# (docs/plans/browser-host.md 5.4). The work is install/firewall-check.mjs:
#
#   firewall-check.sh load    workwrk-browser-firewall.service, before Docker
#   firewall-check.sh check   workwrk-browser-firewall-check.timer, every 5 minutes,
#                             and the host's ExecStartPre (no argument means check)
#   firewall-check.sh print   the file it would write
#
# Every load runs `nft -c -f` on the file before `nft -f`.
set -eu
here=$(dirname "$(readlink -f "$0")")
exec /usr/bin/node "$here/firewall-check.mjs" "${1:-check}"
