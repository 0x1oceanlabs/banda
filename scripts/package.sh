#!/usr/bin/env bash
# Packs Banda into an app (ADR 0033, step 2): the engine, the page and the
# window, in client/desktop/dist/.
#
#   scripts/package.sh [stable|dev|local]
#
# BANDA_VERSION names the version (0.X.Y, 0.X.Y-dev.N); unset, it is the
# workspace's, marked local. On Linux, an AppImage; on macOS, a zip of the
# app for Apple silicon, signed ad hoc.
set -euo pipefail
cd "$(dirname "$0")/.."

export BANDA_CHANNEL=${1:-local}
if [[ -z ${BANDA_VERSION:-} ]]; then
  workspace=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
  export BANDA_VERSION="$workspace-local"
fi
echo "== Banda $BANDA_VERSION ($BANDA_CHANNEL)"

# On macOS, the engine's line tables (Cargo.toml) stay in the objects it is
# linked from, unless they are packed beside it, as banda.dSYM, which the
# app carries.
if [[ $(uname) == Darwin ]]; then
  export CARGO_PROFILE_RELEASE_SPLIT_DEBUGINFO=packed
fi
cargo build --release --bin banda
pnpm install --frozen-lockfile --silent
# The app carries the licenses of what it is built from (ADR 0038).
node scripts/licenses.mjs --notices target/release/THIRD-PARTY-NOTICES.txt
pnpm --filter @banda/desktop build
pnpm --filter @banda/desktop exec electron-builder --config electron-builder.config.mjs --publish never
