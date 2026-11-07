#!/usr/bin/env bash
# Links the checkout's target/ to the runner's volume. cargo keeps every
# build's artifacts and removes none, so past trim_gb it first drops what
# the next build can best do without: release/, which only release.yml's
# pack builds on (a later pack on this runner then starts cold), and
# debug/incremental, which only speeds up rebuilding Banda's own crates.
# Only if target/ is still past empty_gb is it emptied, and the next build
# starts cold, once.
set -euo pipefail
: "${BANDA_CI_TARGET:?the runner image sets BANDA_CI_TARGET (ci/Dockerfile)}"
trim_gb=12
empty_gb=15
trimmed=(debug/incremental)
# The pack builds on release/ right after this; any other job drops it.
[[ ${GITHUB_WORKFLOW:-} == release ]] || trimmed+=(release)

kb() { du -sk "$1" | cut -f1; }
gb() { printf '%d.%d GB' $(($1 / 1048576)) $(($1 % 1048576 * 10 / 1048576)); }

mkdir -p "$BANDA_CI_TARGET"
size=$(kb "$BANDA_CI_TARGET")
if ((size > trim_gb * 1048576)); then
  echo "target/ is $(gb "$size"), past $trim_gb GB"
  dropped=0
  for dir in "${trimmed[@]}"; do
    path=$BANDA_CI_TARGET/$dir
    # Not there, or empty: nothing to drop.
    [[ -d $path && -n $(find "$path" -mindepth 1 -print -quit) ]] || continue
    echo "  dropped $dir ($(gb "$(kb "$path")"))"
    rm -rf "${path:?}"
    dropped=1
  done
  if ((dropped)); then
    size=$(kb "$BANDA_CI_TARGET")
    echo "target/ is now $(gb "$size")"
  fi
fi
if ((size > empty_gb * 1048576)); then
  echo "target/ is $(gb "$size"), past $empty_gb GB: emptied, this build starts cold"
  find "$BANDA_CI_TARGET" -mindepth 1 -delete
fi
ln -sfn "$BANDA_CI_TARGET" target
