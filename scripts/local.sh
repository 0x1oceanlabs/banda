#!/usr/bin/env bash
# Runs a checkout's window, Banda Local, in a systemd user unit of its own
# (ADR 0086, decision 7), so a test run lives and dies apart from the Agent
# or the terminal that started it. Chromium moves the window's main
# process into a scope of its own once it runs, app-banda\x2dlocal-<pid>,
# but what it started before, its helpers and often the engine, stays
# where it began: when an Agent's unit stopped, they stopped with it, and
# the window crashed ("GPU process isn't usable").
#
#   scripts/local.sh [--unit NAME] [ARGS]
#
# It is the Electron of the folder it starts in, as `pnpm exec electron`
# is, with ARGS: `scripts/local.sh .` in app/desktop. scripts/try.sh, the
# end-to-end tests and `pnpm --filter @banda/desktop start` start the
# window through it. --unit names the unit NAME.scope; without it, systemd
# names it.
#
# Stop the window as the Person does, or with SIGTERM to its main process,
# never by killing its process group or stopping its unit while it runs:
# both stop the helpers under the main process, which then crashes. The
# unit ends with its last process; stopping it once the main process has
# gone ends whatever is left, 5 s after SIGTERM.
#
# Where no user systemd answers (macOS, a container, CI), it runs Electron
# as it is.
set -euo pipefail

fail() { echo "local.sh: $*" >&2; exit 2; }

unit=()
if [[ ${1:-} == --unit ]]; then
  [[ -n ${2:-} ]] || fail "--unit takes a name"
  unit=(--unit="$2")
  shift 2
fi

# Electron's own way to its program, which fetches it first when missing.
electron=$(node -p 'require("electron")' | tail -n 1) ||
  fail "no Electron in $PWD: start it in app/desktop, after pnpm install"

version=
if [[ $(uname -s) == Linux ]] && command -v systemd-run >/dev/null; then
  version=$(systemctl --user show --property=Version --value 2>/dev/null) || version=
fi
[[ -n $version ]] || exec "$electron" "$@"

properties=(--property=TimeoutStopSec=5)
# A process the kernel kills for want of memory, a page's, does not stop
# the rest; a scope takes it from systemd 253.
major=${version%%[!0-9]*}
((${major:-0} >= 253)) && properties+=(--property=OOMPolicy=continue)
exec systemd-run --user --scope --quiet --collect "${unit[@]}" \
  --description="Banda Local from $PWD" "${properties[@]}" \
  -- "$electron" "$@"
