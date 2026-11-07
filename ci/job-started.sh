#!/usr/bin/env bash
# Runs before every job on a devbox runner (ACTIONS_RUNNER_HOOK_JOB_STARTED,
# ci/Dockerfile); its failure fails the job before any step. A fork's PR runs
# its own copy of the workflows, `runs-on` too, so this, not ci.yml, keeps a
# fork's code off devbox (ADR 0038, decision 4).
#
# A pushed tag runs the workflows of the commit it names, and every
# release.yml before ADR 0092's step 2 built a Stable from a tag, its first
# job on devbox. So no job starts here for a pushed tag: one pushed by hand
# ships nothing, on any commit.
set -euo pipefail
if [[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/tags/* ]]; then
  echo "::error::$GITHUB_REF was pushed, and devbox builds no tag: one pushed by hand ships nothing (ADR 0092, step 2)"
  exit 1
fi
from=$(jq -r '
  if has("pull_request") then .pull_request.head.repo.full_name // "a deleted fork"
  elif has("workflow_run") then .workflow_run.head_repository.full_name // "a deleted fork"
  else env.GITHUB_REPOSITORY end' "$GITHUB_EVENT_PATH")
if [[ $from != "$GITHUB_REPOSITORY" ]]; then
  echo "::error::devbox runs only $GITHUB_REPOSITORY's branches, not $from's (ADR 0038, decision 4)"
  exit 1
fi
