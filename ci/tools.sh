#!/usr/bin/env bash
# What a check job needs beyond its checkout, on either runner. devbox's
# image has Node and pnpm (ci/Dockerfile) and keeps target/ in its volume;
# GitHub's, where a fork's PR runs (ADR 0038, decision 4), has rustup and
# what Electron runs on, so Node and pnpm come from ci/Dockerfile's pins.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ${RUNNER_ENVIRONMENT:-} == github-hosted ]]; then
  arg() { sed -n "s/^ARG $1=//p" ci/Dockerfile; }
  node=$(arg NODE_VERSION) dir=$RUNNER_TEMP/node
  curl -fsSLo "$dir.tar.xz" "https://nodejs.org/dist/v$node/node-v$node-linux-x64.tar.xz"
  echo "$(arg NODE_SHA256)  $dir.tar.xz" | sha256sum -c -
  mkdir -p "$dir" && tar -xJf "$dir.tar.xz" -C "$dir" --strip-components=1
  export PATH=$dir/bin:$PATH && echo "$dir/bin" >> "$GITHUB_PATH"
  # package.json's pin itself, so pnpm need not switch to it.
  npm install --global --silent "$(jq -r .packageManager package.json)"
  # As on devbox: no check reads debug info.
  echo CARGO_PROFILE_DEV_DEBUG=0 >> "$GITHUB_ENV"
else
  ci/target.sh
fi
rustup toolchain install
