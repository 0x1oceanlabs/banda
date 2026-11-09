#!/usr/bin/env bash
# Every check a change must pass, in the order a failure is cheapest to
# find. CI runs the parts side by side (.github/workflows/ci.yml).
#
#   scripts/check.sh               every part: rust, ts, window
#   scripts/check.sh --no-window   all but the desktop window's end-to-end tests
#   scripts/check.sh PART...       only these parts, in this order
#   scripts/check.sh windows       the Rust for Windows: only by its name, as on
#                                  Linux it builds every crate a second time
set -euo pipefail
cd "$(dirname "$0")/.."

parts=()
for arg in "$@"; do
  case "$arg" in
    --no-window) parts+=(rust ts) ;;
    rust | ts | window | windows) parts+=("$arg") ;;
    *) echo "check.sh: unknown argument $arg (rust, ts, window, windows, --no-window)" >&2; exit 2 ;;
  esac
done
((${#parts[@]})) || parts=(rust ts window)

step() { printf '\n== %s\n' "$*"; }

# Runs a command quietly, and shows all it said only if it fails: pnpm's
# --silent hides a failing test's output too, which left CI red with no
# reason given.
quiet() {
  local said
  if ! said=$("$@" 2>&1); then
    printf '%s\n' "$said" >&2
    return 1
  fi
}

# pnpm's packages, and Electron's binary: Electron fetches that on first
# use, and tests that load it side by side each began the fetch and broke
# one another's. Fetched here once, it is a no-op once there.
packages() {
  quiet pnpm install --frozen-lockfile
  quiet pnpm --filter @banda/desktop exec install-electron
}

# The Rust tests write sdk/contract/src/generated; a change there means the
# TypeScript types on disk were stale.
types() { find sdk/contract/src/generated -type f -print0 | sort -z | xargs -0 sha256sum; }

rust() {
  step "Rust: format, lints"
  cargo fmt --all --check
  cargo clippy --workspace --all-targets --quiet -- -D warnings

  step "Rust: tests"
  local before; before=$(types)
  # The agents module's tests write checkpoints that the Pane's projection
  # must reproduce (ADR 0014, decision 3); the ts part's tests read them, so
  # it runs after this one, in the same checkout.
  export BANDA_CHECKPOINTS="$PWD/target/checkpoints"
  rm -rf "$BANDA_CHECKPOINTS" && mkdir -p "$BANDA_CHECKPOINTS"
  # The engine's tests build the adapters Banda carries from npm's
  # packages, and start them on the host's Node (ADR 0059).
  packages
  # The fence's tests skip, saying why, where the system refuses the
  # namespaces they make, as devbox's runners do: ci.yml's `fence` part
  # runs them on a runner that gives them (ci/README.md). Here such a skip
  # would hide a fence that no longer holds. Set BANDA_FENCE_TESTS=skip on
  # a system that refuses them.
  [[ -n "${CI:-}" ]] || export BANDA_FENCE_TESTS="${BANDA_FENCE_TESTS:-require}"
  cargo test --workspace --quiet
  # cargo test links target/debug/banda for the engine's own tests but
  # writes the list of sources beside it (banda.d) only when cargo build
  # asks for it. The ts part's tests check that list against this checkout
  # (sdk/contract/test/built.ts), and on CI's shared target/ the list left
  # there is another checkout's. Everything is compiled by now, so this
  # only links and writes the lists.
  cargo build --workspace --quiet

  step "The modules' unstable marks (ADR 0022, decision 6)"
  # cargo build made it, and holds the count at its ceiling.
  target/debug/banda modules --unstable

  step "The TypeScript types match the Rust"
  if [[ "$before" != "$(types)" ]]; then
    echo "cargo test rewrote sdk/contract/src/generated: review it and run again." >&2
    exit 1
  fi
}

ts() {
  step "TypeScript: format, lints, types, tests"
  packages
  pnpm exec prettier --check . --log-level warn
  # A Mac's files ignore case, so an import of ./Toasts finds toasts.ts
  # there: no two modules in a folder may differ by case alone.
  local clash
  clash=$(git ls-files '*.ts' '*.tsx' '*.mts' '*.js' '*.mjs' |
    sed -E 's/\.(test\.)?[mc]?[jt]sx?$//' | sort -u | sort -f | uniq -di)
  if [[ -n $clash ]]; then
    echo "Modules that differ by case alone, which a Mac cannot tell apart:" >&2
    echo "$clash" >&2
    return 1
  fi
  pnpm exec eslint .
  quiet pnpm -r typecheck
  quiet pnpm -r test

  step "What Banda ships is under a license it may ship (ADR 0038, decision 1)"
  node scripts/licenses.mjs
  # And for Windows, whose engine is built of crates of its own (ADR 0090).
  node scripts/licenses.mjs --target x86_64-pc-windows-msvc
}

window() {
  step "The desktop window, end to end"
  # The window starts the engine and the fake agent from target/debug.
  cargo build --workspace --quiet
  packages
  # BANDA_E2E_SHARD (1/4, …) runs one part of the tests: CI splits them
  # over runners, as one at a time they took 19 minutes.
  pnpm --filter @banda/desktop --silent e2e ${BANDA_E2E_SHARD:+--shard="$BANDA_E2E_SHARD"}
}

# The workspace for Windows, with its lints as errors as rust has them, and
# its tests built; windows.yml runs them on Windows (ADR 0090, decision 9).
# From Linux it is cargo-xwin's, which brings Microsoft's CRT and Windows
# SDK under Microsoft's license (`cargo install cargo-xwin`, and clang);
# on Windows, Visual Studio's build tools bring them.
windows() {
  step "Rust for Windows: lints, the tests build"
  local cargo=(cargo) target=()
  if [[ ${OS:-} != Windows_NT ]]; then
    cargo=(cargo xwin) target=(--target x86_64-pc-windows-msvc)
    quiet rustup target add x86_64-pc-windows-msvc
  fi
  "${cargo[@]}" clippy --workspace --all-targets "${target[@]}" --quiet -- -D warnings
  "${cargo[@]}" test --workspace --no-run "${target[@]}" --quiet
}

for part in "${parts[@]}"; do "$part"; done

printf '\nAll checks passed.\n'
