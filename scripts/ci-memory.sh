#!/bin/bash
# How close a CI step comes to the runner's memory, reported on every run.
#
# Usage: scripts/ci-memory.sh <label> <log file, or - for this output> <command> [args...]
# (the label without a comma or a colon: either ends a GitHub annotation's title)
#
# Runs the command, sampling the runner's memory once a second, then prints a
# ::notice:: with the peak in use and the least left, and a ::warning:: when
# the step came within 1 GB of the runner's memory or used swap. Exits with
# the command's own status. On a machine without /proc/meminfo (a Mac) it
# runs the command and says nothing was measured.
#
# WHY. A private repository's runner has 2 CPUs and 8 GB, and the two heavy
# steps already use most of it: measured on 2026-11-01 under a 6.5 GB limit,
# the type check peaks at 5.5 GB and the production build at 6.0 GB. A step
# that outgrows the runner is killed with no message at all, so the warning
# is there to show the growth weeks before that (.github/workflows/ci.yml,
# MEMORY).

set -u
label=${1:?label}
log=${2:?log file or -}
shift 2

if [ ! -r /proc/meminfo ]; then
  if [ "$log" = "-" ]; then "$@"; else "$@" > "$log" 2>&1; fi
  rc=$?
  echo "memory ($label): not measured here (no /proc/meminfo)"
  exit $rc
fi

state=$(mktemp)
total=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
# The first reading now, so even a step shorter than a second is measured.
first=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
echo "$first 0" > "$state"
(
  least=$first
  swap=0
  while :; do
    avail=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
    used=$(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{print t-f}' /proc/meminfo)
    [ "$avail" -lt "$least" ] && least=$avail
    [ "$used" -gt "$swap" ] && swap=$used
    # Whole or not at all: the sampler can be stopped mid-write.
    echo "$least $swap" > "$state.next" && mv -f "$state.next" "$state"
    sleep 1
  done
) &
sampler=$!

if [ "$log" = "-" ]; then "$@"; else "$@" > "$log" 2>&1; fi
rc=$?

kill "$sampler" 2>/dev/null
wait "$sampler" 2>/dev/null
read -r least swap < "$state" || true
least=${least:-$total}
swap=${swap:-0}
rm -f "$state" "$state.next"
total_mb=$(( total / 1024 ))
left_mb=$(( least / 1024 ))
peak_mb=$(( total_mb - left_mb ))
swap_mb=$(( swap / 1024 ))
echo "::notice title=memory ($label)::peak ${peak_mb} MB in use of ${total_mb} MB, ${left_mb} MB left at the tightest, swap ${swap_mb} MB"
if [ "$left_mb" -lt 1024 ] || [ "$swap_mb" -gt 256 ]; then
  echo "::warning title=memory ($label)::came within ${left_mb} MB of the runner's memory (swap ${swap_mb} MB). This step will soon not fit: see .github/workflows/ci.yml, MEMORY."
fi
exit $rc
