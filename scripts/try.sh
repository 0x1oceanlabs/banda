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
# trial's Spaces and its history stay between runs. A window of the trial
# that still runs closes first, so the new build is the one shown. The
# window serves CDP, which scripts/drive.mjs drives: an Agent sees and
# works what it built.
#
#   --real        the engine offers Claude Code and Codex, as Banda does
#   --fresh       forget the trial's Spaces and settings first
#   --no-build    start what was built last, without building
#   --hidden      no window on the screen, nor its notices and sounds: it
#                 draws on a screen of its own, for an Agent (Linux)
#   --detach      start in the background and come back once the window
#                 runs; what it prints goes to the trial's run.log
#   --stop        close the trial's window and stop
#   --list        the trials there are, and which run
#   --forget      remove the trial of TREE and stop
#
# CARGO_TARGET_DIR shared by every tree saves the dependencies' build:
#   export CARGO_TARGET_DIR=~/.cache/banda-target
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
# The main checkout, which the worktrees are beside (AGENTS.md).
main=$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")
worktrees=$(dirname "$main")/banda-worktrees
# drive.mjs finds the trials where this script keeps them.
export BANDA_TRIALS=${BANDA_TRIALS:-${XDG_STATE_HOME:-$HOME/.local/state}/banda-trial}
trials=$BANDA_TRIALS

fail() { echo "try.sh: $*" >&2; exit 2; }
step() { printf '\n== %s\n' "$*"; }

real=0 fresh=0 build=1 hidden=0 detach=0 stop=0 list=0 forget=0 tree=
for arg in "$@"; do
  case "$arg" in
    --real) real=1 ;;
    --fresh) fresh=1 ;;
    --no-build) build=0 ;;
    --hidden) hidden=1 ;;
    --detach) detach=1 ;;
    --stop) stop=1 ;;
    --list) list=1 ;;
    --forget) forget=1 ;;
    -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    -*) fail "unknown option $arg (see --help)" ;;
    *) [[ -z $tree ]] || fail "one tree at a time"; tree=$arg ;;
  esac
done

# The trial's window runs while Chromium holds its profile's lock, a link
# to <host>-<pid>.
running() {
  local lock
  lock=$(readlink "$1/state/window/SingletonLock" 2>/dev/null) || return 1
  kill -0 "${lock##*-}" 2>/dev/null
}
# Closes it as the Person does, so main stops the engine: a signal would
# leave a crash behind.
close() {
  running "$trial" || return 0
  node "$here/scripts/drive.mjs" --trial "$slug" close
  for _ in $(seq 40); do
    running "$trial" || return 0
    sleep 0.25
  done
  fail "the window of $slug did not close"
}

if ((list)); then
  shopt -s nullglob
  listed=("$trials"/*/)
  ((${#listed[@]})) || echo "No trials yet."
  for each in "${listed[@]}"; do
    running "$each" && echo "$(basename "$each")  (runs)" || basename "$each"
  done
  exit 0
fi
((hidden)) && [[ $(uname -s) != Linux ]] && fail "--hidden is for Linux"

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

((stop || forget || fresh)) && close
((stop)) && exit 0
((forget || fresh)) && rm -rf "$trial"
if ((forget)); then
  echo "Forgot the trial of $slug."
  exit 0
fi

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

# A window of the trial from the last build.
close

step "Banda Local from $slug"
echo "Its things: $trial"
cd app/desktop
# Started from an AppImage's terminal (Banda Dev's, T3 Code's), the shell
# carries that AppImage's variables, and the window would list and update
# that one as itself (entry.ts, update.ts). T3 Code's makes Electron Node.
unset APPIMAGE APPDIR ARGV0 OWD ELECTRON_RUN_AS_NODE
export BANDA_ROOT=$trial/root BANDA_DATA=$trial/data BANDA_STATE=$trial/state \
  BANDA_CONFIG=$trial/config BANDA_ENGINE=$trial/bin/banda
# Chromium writes the port it took in the window's profile, for drive.mjs.
port=$trial/state/window/DevToolsActivePort
rm -f "$port"
flags=(--remote-debugging-port=0)
if ((hidden)); then
  flags+=(--ozone-platform=headless --ozone-override-screen-size=1600,1000 --mute-audio)
  # The notices go to a list, as the end-to-end tests' do.
  export BANDA_DESKTOP=recorded
fi
window=(node_modules/.bin/electron . "${flags[@]}")
((detach)) || exec "${window[@]}"

# Its own session, so it outlives the shell that started it.
$(command -v setsid) nohup "${window[@]}" >"$trial/run.log" 2>&1 </dev/null &
started=$! waited=0
until [[ -f $port ]] && running "$trial"; do
  if ! kill -0 "$started" 2>/dev/null; then
    tail -n 20 "$trial/run.log" >&2
    fail "the window stopped as it started: $trial/run.log"
  fi
  ((++waited < 120)) || fail "the window did not start in 30 s: $trial/run.log"
  sleep 0.25
done
node "$here/scripts/drive.mjs" --trial "$slug" started
cat <<EOF
Drive it: scripts/drive.mjs --trial $slug shot (--help)
Its logs: $trial/state/logs/{window,engine}.log, and $trial/run.log
Close it: scripts/try.sh --stop $slug
EOF
