#!/usr/bin/env bash
# Builds a branch and opens a Banda window from it to click through, beside
# the Banda you work in and beside the trials of other branches.
#
#   scripts/try.sh [OPTIONS] [TREE]
#
# TREE is a checkout or worktree, or the slug of one in ../banda-worktrees;
# without it, the tree this script is in. Each tree gets a trial of its own
# under ~/.local/state/banda-trial/<slug>: its Spaces, settings and logs,
# so it never touches Banda, Banda Dev or Banda Local, and two trials run
# at once (ADR 0033: BANDA_ROOT, BANDA_DATA, BANDA_STATE and BANDA_CONFIG
# move each folder, and the window's lock follows the state folder).
#
# It runs the fake agent by default, so a trial costs no tokens. The
# trial's Spaces and its history stay between runs.
#
#   --real        the engine offers Claude Code and Codex, as Banda does
#   --fresh       forget the trial's Spaces and settings first
#   --no-build    start what was built last, without building
#   --list        the trials there are
#   --forget      remove the trial of TREE and stop
#
# CARGO_TARGET_DIR shared by every tree saves the dependencies' build:
#   export CARGO_TARGET_DIR=~/.cache/banda-target
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
# The main checkout, which the worktrees are beside (AGENTS.md).
main=$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")
worktrees=$(dirname "$main")/banda-worktrees
trials=${BANDA_TRIALS:-${XDG_STATE_HOME:-$HOME/.local/state}/banda-trial}

fail() { echo "try.sh: $*" >&2; exit 2; }
step() { printf '\n== %s\n' "$*"; }

real=0 fresh=0 build=1 list=0 forget=0 tree=
for arg in "$@"; do
  case "$arg" in
    --real) real=1 ;;
    --fresh) fresh=1 ;;
    --no-build) build=0 ;;
    --list) list=1 ;;
    --forget) forget=1 ;;
    -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) fail "unknown option $arg (--real, --fresh, --no-build, --list, --forget)" ;;
    *) [[ -z $tree ]] || fail "one tree at a time"; tree=$arg ;;
  esac
done

if ((list)); then
  [[ -d $trials ]] && ls -1 "$trials" || echo "No trials yet."
  exit 0
fi

# The tree: a path, a slug, or this one.
if [[ -z $tree ]]; then
  tree=$here
elif [[ -d $tree ]]; then
  tree=$(cd "$tree" && pwd)
elif [[ -d $worktrees/$tree ]]; then
  tree=$worktrees/$tree
else
  fail "no tree $tree (a path, or a slug in $worktrees)"
fi
[[ -f $tree/app/desktop/package.json ]] || fail "$tree is not a Banda checkout"
slug=$(basename "$tree")
trial=$trials/$slug

if ((forget)); then
  rm -rf "$trial"
  echo "Forgot the trial of $slug."
  exit 0
fi
((fresh)) && rm -rf "$trial"

# The window's lock is a unix socket in the state folder, which has a short
# limit on Linux (108 bytes).
((${#trial} < 70)) || fail "the path $trial is too long for the window's socket; set BANDA_TRIALS to a shorter one"

cd "$tree"
target=${CARGO_TARGET_DIR:-$tree/target}

if ((build)); then
  step "The engine, and the fake agent"
  cargo build --bin banda --bin banda-fake-agent
  # The trial has the engine of the last build, not the shared target's,
  # which another tree's build replaces.
  mkdir -p "$trial/bin"
  cp -f "$target/debug/banda" "$target/debug/banda-fake-agent" "$trial/bin/"

  step "The page and the window"
  # Install when a package's list changed since the last install.
  if [[ ! -d node_modules || pnpm-lock.yaml -nt node_modules/.modules.yaml ]]; then
    pnpm install --frozen-lockfile --silent
  fi
  pnpm --filter @banda/desktop exec install-electron
  pnpm --filter @banda/web build
  (cd app/desktop && node build.mjs)
fi
[[ -x $trial/bin/banda ]] || fail "nothing built for $slug yet: run without --no-build"

mkdir -p "$trial"/{root,data,state,config}
if ((real)); then
  rm -f "$trial/config/harnesses.toml"
elif [[ ! -f $trial/config/harnesses.toml ]]; then
  cat >"$trial/config/harnesses.toml" <<EOF
[[harness]]
id = "fake"
name = "Fake AI"
command = "$trial/bin/banda-fake-agent"
EOF
fi

step "Banda Local from $slug"
echo "Its things: $trial"
cd app/desktop
# Started from an AppImage's terminal (Banda Dev's, T3 Code's), the shell
# carries that AppImage's variables, and the window would list and update
# that one as itself (entry.ts, update.ts).
unset APPIMAGE APPDIR ARGV0 OWD
BANDA_ROOT=$trial/root BANDA_DATA=$trial/data BANDA_STATE=$trial/state \
  BANDA_CONFIG=$trial/config BANDA_ENGINE=$trial/bin/banda \
  exec pnpm exec electron .
