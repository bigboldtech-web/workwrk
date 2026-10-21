#!/bin/sh
# The browser server's daily maintenance, as root (docs/plans/browser-host.md
# 8.4): workwrk-browser-maint.service runs it from its timer at 04:30 server
# time. The work is install/maint.mjs:
#
#   maint.sh              drain only when an upgrade of Docker, containerd,
#                         Caddy or Node, or a reboot, is pending; apply; restart
#   maint.sh drain-wait   drain and wait for the open browsers (install.sh --update)
#   maint.sh undrain      undrain, best effort (install.sh --update, when it stops after its drain)
set -eu
here=$(dirname "$(readlink -f "$0")")
exec /usr/bin/node "$here/maint.mjs" "${1:-run}"
