#!/usr/bin/env bash
# The CI runners on devbox, on CI's own rootless engine (ci/README.md). Run
# from a checkout of main by an operator with sudo.
set -euo pipefail

usage() {
  cat <<'USAGE'
usage: ci/devbox.sh compose ARGS... | docker ARGS...

  compose  `docker compose -f compose.yaml ARGS…` as banda-ci, against its
           engine, from a copy of ci/ in banda-ci's home (the operator's
           checkout is not readable by banda-ci). RUNNER_TOKEN is passed
           through for a first start.
  docker   `docker ARGS…` as banda-ci against its engine.
USAGE
}

ci_user=banda-ci
prefix=/opt/banda-ci/docker-29.7.2
here=$(cd "$(dirname "$0")" && pwd)
home=$(getent passwd "$ci_user" | cut -d: -f6)

# Runs a command as banda-ci with its user manager's environment and engine.
as_ci() {
  local uid; uid=$(id -u "$ci_user")
  sudo -u "$ci_user" --preserve-env=RUNNER_TOKEN \
    env -C "$home" XDG_RUNTIME_DIR="/run/user/$uid" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
        DOCKER_HOST="unix:///run/user/$uid/docker.sock" PATH="$prefix/bin:/usr/local/bin:/usr/bin:/bin" \
    "$@"
}

compose() {
  sudo rsync -a --delete --chown="$ci_user:$ci_user" "$here/" "$home/runners/"
  as_ci docker compose -f runners/compose.yaml "$@"
}

[ -x "$prefix/bin/docker" ] || { echo "devbox.sh: no CI engine at $prefix (ci/README.md)" >&2; exit 1; }
case ${1:-} in
  compose) shift; compose "$@" ;;
  docker) shift; as_ci docker "$@" ;;
  -h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
