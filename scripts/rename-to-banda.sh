#!/usr/bin/env bash
# Bandaso is Banda now: this renames it in every tracked file. A branch made
# before the rename runs it at its root, commits, then rebases onto main.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git ls-files -z |
  grep -zvE '^(scripts/rename-to-banda\.sh|app/web/src/renamed\.ts)$' |
  xargs -0 grep -lIZ -i bandaso |
  xargs -0 -r sed -i -e 's/BANDASO/BANDA/g' -e 's/Bandaso/Banda/g' -e 's/bandaso/banda/g'
# A shorter name can fit a call on one line.
cargo fmt --all
