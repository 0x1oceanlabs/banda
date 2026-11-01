#!/usr/bin/env bash
# Starts the CI runner named $1 from its volume (/state). The first start
# registers it with RUNNER_TOKEN, a one-hour registration token
# (ci/README.md); later starts reuse the registration kept in /state/runner.
set -euo pipefail
name=${1:?compose.yaml names the runner}

mkdir -p /state/runner && cd /state/runner
# The runner updates itself in place; a fresh volume starts from the image.
[ -x ./run.sh ] || cp -a /opt/actions-runner/. .

if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?the first start needs RUNNER_TOKEN (ci/README.md)}"
  ./config.sh --unattended --replace \
    --url https://github.com/0x1oceanlabs/banda --token "$RUNNER_TOKEN" \
    --name "$name" --labels devbox --no-default-labels \
    --work /state/work
fi
unset RUNNER_TOKEN
exec ./run.sh
