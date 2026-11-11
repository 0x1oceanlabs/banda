#!/usr/bin/env bash
# Keeps the shots a CI run of the window's tests made as the ones
# client/desktop/e2e/themes.spec.ts compares with (ADR 0100, decision 4):
# for a change to how Banda draws that means to show, or for a look the
# spec has no shot of yet.
#
#   scripts/bless-shots.sh <run id>
#
# The run is one whose themes test failed: its shard uploads what it shot
# (window-traces-*), each look as <look>-actual.png. The shots are CI's
# own, as fonts and their rendering differ machine to machine. Look at
# the difference before you commit it: git diff --stat, and the pictures.
set -euo pipefail
run=${1:?usage: scripts/bless-shots.sh <run id>}
here=$(cd "$(dirname "$0")/.." && pwd)
shots=$here/client/desktop/e2e/shots
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh run download "$run" --pattern 'window-traces-*' --dir "$work"
mkdir -p "$shots"
declare -A kept
# A retry shoots the same build again: either try's shots will do.
while IFS= read -r shot; do
  look=$(basename "$shot" -actual.png)
  cp "$shot" "$shots/$look.png"
  kept[$look]=1
done < <(find "$work" -path '*themes-*' -name '*-actual.png' | sort)
((${#kept[@]})) || { echo "bless-shots.sh: run $run has no shots of the themes" >&2; exit 1; }
echo "kept ${#kept[@]} looks' shots in client/desktop/e2e/shots"
