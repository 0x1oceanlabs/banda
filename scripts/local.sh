#!/usr/bin/env bash
# Runs a checkout's window, Banda Local, in a systemd user unit of its own
# (ADR 0086, decision 7), so a test run lives and dies apart from the Agent
# or the terminal that started it. Chromium moves the window's main
# process into a systemd scope of its own once it runs,
# app-banda\x2dlocal-<pid>, but what it started before, its helpers and
# often the engine, stays where it began: when an Agent's unit stopped,
# they stopped with it, and the window crashed ("GPU process isn't usable").
#
#   scripts/local.sh [--unit NAME] [ARGS]
#
# It is the Electron of the folder it starts in, as `pnpm exec electron`
# is, with ARGS: `scripts/local.sh .` in app/desktop. --unit names the unit
# NAME.scope; without it, systemd names it. With BANDA_LOCAL_PARENT set to
# a pid, the window closes once that process has gone, however it went: a
# test's window, which nothing else closes once its test runner is killed.
#
# Stop the window as the Person does, or with SIGTERM to its main process,
# never by killing its process group or stopping its unit while it runs:
# both stop the helpers under the main process, which then crashes.
#
# Where no user systemd answers (macOS, a container, CI), it runs Electron
# as it is.
set -euo pipefail

fail() { echo "local.sh: $*" >&2; exit 2; }

# Inside the unit: SIGTERM to the window once BANDA_LOCAL_PARENT has gone.
# The watch is in the window's unit, so it outlives the runner's, and it
# lets go of the window's output and Playwright's pipes, whose end
# Playwright waits for.
if [[ ${1:-} == --watched ]]; then
  shift
  parent=$BANDA_LOCAL_PARENT main=$$
  unset BANDA_LOCAL_PARENT
  ( (
    while kill -0 "$main" 2>/dev/null; do
      kill -0 "$parent" 2>/dev/null || exec kill -TERM "$main"
      sleep 1
    done
  ) </dev/null >/dev/null 2>&1 3>&- 4>&- & )
  exec "$@"
fi

unit=
if [[ ${1:-} == --unit ]]; then
  [[ -n ${2:-} ]] || fail "--unit takes a name"
  unit=$2
  shift 2
fi

# Electron's own way to its program, which fetches it first when missing.
electron=$(node -p 'require("electron")' | tail -n 1) ||
  fail "no Electron in $PWD: start it in app/desktop, after pnpm install"
run=("$electron" "$@")
if [[ -n ${BANDA_LOCAL_PARENT:-} ]]; then
  [[ $BANDA_LOCAL_PARENT =~ ^[0-9]+$ ]] || fail "BANDA_LOCAL_PARENT takes a pid"
  run=("$0" --watched "${run[@]}")
fi

version=$(systemctl --user show --property=Version --value 2>/dev/null) || version=
[[ -n $version ]] || exec "${run[@]}"

properties=(--property=TimeoutStopSec=5)
# When the kernel kills one process for want of memory, a page's renderer
# say, the rest go on. Systemd scopes take OOMPolicy from systemd 253.
major=${version%%[!0-9]*}
((${major:-0} >= 253)) && properties+=(--property=OOMPolicy=continue)
exec systemd-run --user --scope --quiet --collect ${unit:+"--unit=$unit"} \
  --description="Banda Local from $PWD" "${properties[@]}" -- "${run[@]}"
