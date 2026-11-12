#!/usr/bin/env bash
# Packs Banda into an app (ADR 0033, step 2): the engine, the page and the
# window, in client/desktop/dist/; beside it, on Linux and macOS, the engine
# alone (scripts/engine.mjs).
#
#   scripts/package.sh [stable|dev|local]
#
# BANDA_VERSION names the version (0.X.Y, 0.X.Y-dev.N); unset, it is the
# workspace's, marked local. On Linux, an AppImage; on macOS, a zip of the
# app for Apple silicon, signed ad hoc; on Windows, under Git Bash, a
# per-user installer for x64, unsigned (ADR 0090, step 5).
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
# The app carries the licenses of what it is built from (ADR 0038). On
# Windows it also carries a Node, which runs the adapters there (ADR 0090,
# decision 5), and elsewhere the engine bundle does: pinned, checked, and
# in the notices; MSVC writes the engine's line tables beside it, as
# banda.pdb.
licenses=(--notices target/release/THIRD-PARTY-NOTICES.txt)
if [[ ${OS:-} == Windows_NT ]]; then
  # The engine links Microsoft's C runtime in (.cargo/config.toml): one
  # that needs VCRUNTIME140.dll would not start where none is installed.
  if grep -qai vcruntime140 target/release/banda.exe; then
    echo "package.sh: banda.exe needs VCRUNTIME140.dll" >&2
    exit 1
  fi
  platform=win-x64
  node scripts/node.mjs "$platform"
  licenses+=(--node "target/node/$platform")
else
  # Elsewhere the engine bundle carries a Node (scripts/engine.mjs, ADR
  # 0115 step 1b), and so the notices name it: the app's, which the bundle
  # takes as they are.
  platform=$(node -p 'process.platform + "-" + process.arch')
  node scripts/node.mjs "$platform"
  licenses+=(--node "target/node/$platform")
fi
node scripts/licenses.mjs "${licenses[@]}"
pnpm --filter @banda/desktop build
pnpm --filter @banda/desktop exec electron-builder --config electron-builder.config.mjs --publish never

# electron-builder only warns when a resource it was told to pack is
# missing: an app without the adapters it carries (ADR 0059), or on
# Windows without its engine, the engine's line tables or its Node, stops
# here.
resources=$(find client/desktop/dist -maxdepth 4 -type d \
  \( -path '*-unpacked/resources' -o -path '*.app/Contents/Resources' \) -print -quit)
carried=(adapters/claude-agent-acp.mjs adapters/codex-acp.mjs)
if [[ ${OS:-} == Windows_NT ]]; then
  carried+=(banda.exe banda.pdb node/node.exe)
fi
for file in "${carried[@]}"; do
  if [[ ! -s ${resources:-/nowhere}/$file ]]; then
    echo "package.sh: the app carries no $file" >&2
    exit 1
  fi
done

# The engine alone, for a machine with no window and for each machine's
# engine to update itself (ADR 0115, decision 5). Not on Windows yet, whose
# engine is no service (ADR 0090).
if [[ ${OS:-} != Windows_NT ]]; then
  node scripts/engine.mjs "$resources"
fi
