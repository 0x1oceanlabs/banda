#!/usr/bin/env bash
# Links the checkout's target/ to the runner's volume, emptied first once it
# outgrew 15 GB: cargo keeps every build's artifacts and removes none. Over
# the cap the next build starts cold, once.
set -euo pipefail
: "${BANDA_CI_TARGET:?the runner image sets BANDA_CI_TARGET (ci/Dockerfile)}"
mkdir -p "$BANDA_CI_TARGET"
if (($(du -sk "$BANDA_CI_TARGET" | cut -f1) > 15 * 1024 * 1024)); then
  echo "target/ outgrew 15 GB: emptied, this build starts cold"
  find "$BANDA_CI_TARGET" -mindepth 1 -delete
fi
ln -sfn "$BANDA_CI_TARGET" target
