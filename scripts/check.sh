#!/usr/bin/env bash
# Every check a change must pass, in the order a failure is cheapest to
# find. There is no CI yet: run this before a PR. `--no-window` skips the
# end-to-end tests of the desktop window.
set -euo pipefail
cd "$(dirname "$0")/.."

window=1
for arg in "$@"; do
  case "$arg" in
    --no-window) window=0 ;;
    *) echo "check.sh: unknown argument $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s\n' "$*"; }

step "Rust: format, lints"
cargo fmt --all --check
cargo clippy --workspace --all-targets --quiet -- -D warnings

# The Rust tests write contract/src/generated; a change there means the
# TypeScript types on disk were stale.
types() { find contract/src/generated -type f -print0 | sort -z | xargs -0 sha256sum; }

step "Rust: tests"
before=$(types)
cargo test --workspace --quiet
cargo build --workspace --quiet

step "The TypeScript types match the Rust"
if [[ "$before" != "$(types)" ]]; then
  echo "cargo test rewrote contract/src/generated: review it and run again." >&2
  exit 1
fi

step "TypeScript: format, lints, types, tests"
pnpm install --frozen-lockfile --silent
pnpm exec prettier --check . --log-level warn
pnpm exec eslint .
pnpm -r --silent typecheck
pnpm -r --silent test

if [[ $window == 1 ]]; then
  step "The desktop window, end to end"
  pnpm --filter @bandaso/desktop --silent e2e
fi

printf '\nAll checks passed.\n'
