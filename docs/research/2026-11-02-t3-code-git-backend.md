# T3 Code git backend — research for a Rust rebuild

Source: `/tmp/t3src/t3code` @ `c8a601c0`. All paths below are relative to that root.
Abbreviations: **Core** = `apps/server/src/vcs/GitVcsDriverCore.ts`, **Drv** = `apps/server/src/vcs/GitVcsDriver.ts`,
**GM** = `apps/server/src/git/GitManager.ts`, **Bc** = `apps/server/src/vcs/VcsStatusBroadcaster.ts`.

T3 only ever shells out to the `git` CLI (no libgit2). Every call goes through one runner
(`executeRaw`, Core:952) or, for checkpoints, `VcsProcess.run` (`vcs/VcsProcess.ts:195`). PR hosting goes over the
host's REST API, not `gh pr create`.

---

## 0. The process runner (env, timeouts, limits, locks) — do this first in Rust

`executeRaw` (Core:952-1090):

- **Env** (Core:975-984): `{...process.env, GIT_OPTIONAL_LOCKS: "0", ...input.env, ...trace2.env}` plus
  `safe.bareRepository=explicit` injected through `GIT_CONFIG_COUNT/GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n`
  (`VcsProcess.ts:101-133`, it appends after the inherited count so it never touches argv or the user's config).
  On Windows also `core.longpaths=true` the same way (Core:932).
  Comment at Core:977: *"Concurrent status polls must not take index.lock to save refreshed indexes."*
- **`LC_ALL=C`** is NOT global. It's only added by `executeGitWithStableDiagnostics` (Core:1175-1188) for commands whose
  stderr gets parsed: `rev-parse --git-common-dir`, `status`, `diff-index`, `checkout`, `pull`, `config` writes,
  `branch`, `remote add`, `for-each-ref` (refs snapshot).
- **Timeout**: default 30 s (`DEFAULT_TIMEOUT_MS`, Core:58). `timeoutMs: null` = none (all `push` calls, Core:2643,
  2721, 2768, 2778, 2786). Commit is 10 min (`COMMIT_TIMEOUT_MS`, GM:162). Background fetch is 5 min + 1 s force-kill
  (Core:91, 1362-1367). Small probes use 5 s (`show-ref`, `symbolic-ref`, `rev-parse --show-toplevel`). Checkout and
  branch create/rename use 10 s.
- **Concurrency**: a global semaphore of **8** git processes (`gitProcesses`, Core:66), only for commands with a
  timeout <= 30 s (Core:1121-1124), so long pushes/fetches don't starve status. Background status fetches have their own
  semaphore of 4 (Core:950). `VcsProcess` also caps at 8 (`VcsProcess.ts:67`).
- **Output caps**: default 1 MB per stream (Core:68). Output beyond the cap is dropped, and you get `stdoutTruncated`
  plus an optional `"\n\n[truncated]"` marker (Core:69). Diff/status metadata get 16 MiB (Core:75).
- **Config writes**: `writesSharedConfig: true` takes a per-`gitCommonDir` mutex (`withSharedConfigLock`, Core:1094-1107)
  and retries on `config_locked` 10 times every 50 ms (`retryWhileConfigLocked`, Core:3704-3711). The comment says
  `.git/config.lock` can be held by git running *outside* T3, e.g. an agent's.
- **Errors**: stderr is never passed to the client, because it can echo credentials. `classifyGitFailure` (Core:502)
  looks only at lines starting with `fatal:`, `error:`, or `!` and maps them to a fixed enum
  (`GitCommandFailureReason`, `packages/contracts/src/git.ts:344-358`): `authentication_failed`,
  `branch_already_exists`, `branch_checked_out_in_worktree`, `config_locked`, `host_key_unverified`,
  `not_a_repository`, `path_already_exists`, `push_rejected_by_remote`, `push_rejected_non_fast_forward`,
  `ref_not_found`, `remote_unreachable`, `tag_would_be_clobbered`. The regexes are at Core:440-472. Only three
  reasons get a friendly sentence (Core:475-482); everything else reads *"Git command exited with a non-zero
  status."* Fetch/pull have their own fixed messages (`fetchFailureDetail`, Core:574-610).
- **Option injection**: refs starting with `-` are refused (`refuseOptionLikeRefName`, Core:325). It uses
  `--end-of-options` or `--` everywhere, and pathspecs are always `:(top,literal)<path>`.
- **Hook progress**: when a caller wants hook events, it sets `GIT_TRACE2_EVENT=<tmpfile>`, watches the file, and
  parses `child_start`/`child_exit` with `child_class=="hook"` (Core:664-818). That is how commit hook start, output,
  and finish get streamed.
- Fetches that run in the background use `STATUS_UPSTREAM_REFRESH_ENV` (Core:110-116): `GCM_INTERACTIVE=never`,
  `GIT_ASKPASS=""`, `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`.

**Index safety pattern (used 3 times):** whenever T3 needs to stage something the user didn't ask for, it does not touch
`.git/index`. Instead it copies the index to a temp file, `utimes` it back to the original mtime floored to seconds
(this keeps git's racy-timestamp check correct), and runs with `GIT_INDEX_FILE=<tmp>` plus
`-c core.splitIndex=false -c splitIndex.sharedIndexExpire=never` and `update-index --no-split-index`. It is used for:
the review untracked index (Core:2968-3041), the commit-message context (Core:2472-2557), and checkpoint capture
(Drv:899-1243).

---

## 1. Review / Diff panel: `getDiffPreview`, `getBranchCommits`, `getDiffFileContents`

`apps/server/src/review/ReviewService.ts` is a thin guard. It requires the cwd to be inside the server workspace root
or a known workspace (ReviewService.ts:74-94), detects the VCS, and delegates to Core.

### Contract (`packages/contracts/src/review.ts`)
- Input: `{cwd, baseRef?, commitSha?, ignoreWhitespace?, file?: {path, previousPath|null, sourceKind}}` (review.ts:6-18).
  **"Automatic" in the UI = `baseRef` omitted** (web `DiffPanel.tsx:408` shows "Automatic" when there's no baseRef).
- Result: `{cwd, generatedAt, sources: ReviewDiffPreviewSource[]}` (review.ts:85-90). A source is
  `{id, kind, title, commitSubject?, baseRef|null, headRef|null, diff: string, diffHash, truncated, files?: [{path, previousPath|null, additions, deletions}]}`
  (review.ts:54-65).
  **Response = raw unified patch text plus a numstat file list.** No structured hunks: the client parses the patch, and
  T3 forces `--src-prefix=a/ --dst-prefix=b/` because "client patch parsers require a/ and b/ prefixes"
  (Core:82-83). `files` is omitted when the numstat is incomplete (too many untracked files).
- `diffHash` = SHA-256 hex of `JSON.stringify([diff, files])` (Core:3363-3378). It exists so the client can skip work.
  **There is no server-side cache for diff previews**: every call runs git again.

### Common diff args
```ts
REVIEW_DIFF_ARGS = ["diff","--find-renames","--no-color","--no-ext-diff","--no-textconv","--src-prefix=a/","--dst-prefix=b/"]  // Core:84-91
```
Working-tree and branch sources add `"--minimal"` (Core:3427-3431). `ignoreWhitespace` adds `"--ignore-all-space"`.
No `--diff-filter` is used for previews.

### getDiffPreview (Core:3337-3527)
1. Resolves the repo uncached with `rev-parse --git-common-dir`, `rev-parse --show-toplevel`, and
   `symbolic-ref --quiet HEAD` (Core:1433-1492). Everything then runs from `worktreeRoot`.
2. **Commit source** (`commitSha` given; Core:3377-3423):
   - Checks the sha is 40/64 hex, then `["cat-file","-e","<sha>^{commit}"]` with env `GIT_NO_LAZY_FETCH=1`, then
     `["cat-file","commit",sha]`. It reads the raw `parent` line itself, so a shallow graft doesn't make a commit look
     like a root. Then it checks the parent is present. Root commit: parent = empty tree from
     `["hash-object","-t","tree","/dev/null"]` (Core:3043-3051, 3210-3247).
   - Subject: `["show","-s","--no-notes","--no-show-signature","--format=%B",sha]`, capped at 8 KB, first line, 300 chars (Core:3249-3262).
   - Stat: `[...REVIEW_DIFF_ARGS, (--ignore-all-space), "--numstat","-z", parent, sha, "--", ...pathArgs]`.
   - Patch: `[...REVIEW_DIFF_ARGS, (--ignore-all-space), "--patch", parent, sha, "--", ...pathArgs]`.
   - Returns ONE source `{id: sha, kind:"commit", title:"Commit abc1234", baseRef: parent, headRef: sha}`.
3. **Otherwise it always returns TWO sources**, `working-tree` ("Uncommitted") and `branch-range` ("Changes vs <base>")
   (Core:3497-3520).
   - Uncommitted: `git diff ... HEAD --`, which is **worktree vs HEAD, staged and unstaged merged**.
   - Changes: `git diff ... <merge-base> --`, which is **worktree vs merge-base, so it also includes uncommitted and
     untracked work**. It is not `base...HEAD`.
   - Each one runs `--numstat -z` first; if that shows no files, the patch is skipped (Core:3462-3474).
   - If merge-base == HEAD, it runs the pair once and reuses it (Core:3477-3489). Otherwise the two run concurrently.
   - Unborn HEAD: on stderr `bad revision 'HEAD'` it retries against the empty tree (Core:3443-3452, `isUnbornHeadStderr` Core:550).
   - A single-file request (`input.file`) adds `:(top,literal)path` (plus previousPath) and raises the patch cap from
     120 KB to 1 MB.
4. **Untracked files in "Uncommitted"** (`prepareUntrackedReviewIndex`, Core:3053-3090; `prepareReviewIndex`, Core:2968-3041):
   - `["ls-files","--others","--exclude-standard","-z","--",...pathArgs]`
   - If there are more than **5,000** untracked files it gives up (`REVIEW_UNTRACKED_MAX_FILES`, Core:77; the comment
     says "50k files took ~30 s") and marks both sources incomplete (`files` omitted, `truncated: true`, Core:3490-3493).
   - It drops paths that are staged deletions: `["diff","--cached","--name-only","--diff-filter=D","-z","HEAD","--"]`.
   - It copies the index to a temp file (`t3code-review-index-<pid>-*`), restores the mtime, and runs
     `["-c","core.splitIndex=false","-c","splitIndex.sharedIndexExpire=never","update-index","--no-split-index"]`, then
     `["-c","core.splitIndex=false","-c","splitIndex.sharedIndexExpire=never","-c","core.preloadIndex=false","--literal-pathspecs","add","--intent-to-add","--pathspec-from-file=-","--pathspec-file-nul"]`
     with the NUL-joined paths on stdin. All with `GIT_INDEX_FILE=<tmp>`. Both diffs then run with that env, so
     untracked files show up as new files. The user's index is never written.
5. **Limits**: full patch 120,000 bytes (Core:74), single file 1 MiB (Core:78), numstat 16 MiB.
   Binary files: git prints `Binary files ... differ` and numstat `-\t-`, which is parsed as 0/0 (Core:205-223). There is
   no other binary handling in the preview.

### "Automatic" base: `resolveReviewMergeBase` (Core:3092-3137) and `resolveBaseBranchForNoUpstream` (Core:1843-1949)
With an explicit `baseRef`: `refs/heads/*` or `refs/remotes/*` are used as-is, and `x/y` maps to `refs/remotes/x/y`
when `show-ref --verify --quiet` finds it (`resolveComparisonBaseRef`, Core:1806-1824). Otherwise it uses
`refs/heads/<name>` if the branch exists, else the raw string.

Without one (Automatic), in order:
1. `git config --get branch.<cur>.t3-merge-base-ref`. A full ref T3 recorded (written on publish, Core:2747-2760).
2. `branch.<cur>.t3-merge-base`, falling back to the legacy `branch.<cur>.gh-merge-base` (`readBranchBase`, Core:3766-3771; keys at Core:60-65).
3. The default branch of the **primary remote** (`origin` if it exists, else the first `git remote`, Core:1712-1729),
   read with `["symbolic-ref","refs/remotes/<remote>/HEAD"]` (`resolveDefaultBranchName`, Core:1658-1674).
   **This uses `origin/HEAD` only; `init.defaultBranch` is never read.**
4. The hardcoded candidates `"main"`, then `"master"` (Core:117).

For each candidate it prefers `refs/remotes/<primary>/<name>` if it exists, else `refs/heads/<name>`. If the candidate
is the current branch itself, it uses the branch's own upstream instead (`rev-parse --symbolic-full-name <b>@{upstream}`,
Core:1828-1841), because `allowRemoteOfCurrent: true` is set for reviews.
Then: `["merge-base","--end-of-options",comparisonRef,"HEAD"]`. If nothing is found, the base is `HEAD` and the title
is just "Changes".

### getBranchCommits (Core:3264-3335)
`["rev-parse","--verify","--quiet","HEAD"]`, then the merge base as above, then
```ts
["log","-z","--no-notes","--no-show-signature","--format=%H%x00%s%x00%cI","--max-count=101", `${mergeBase}..HEAD`]
```
Capped at 128 KB, 100 commits, subject 300 chars (Core:79-81). Returns `{commits:[{sha,subject,committedAt}], truncated}`.

### getDiffFileContents (Core:3643-3699) — expanding unchanged context
- Input `{cwd, sourceKind, changeType: change|rename-pure|rename-changed|new|deleted, baseRef, headRef, oldPath, newPath}`.
- Old side: `["show","--end-of-options", "<rev>:<oldPath>"]`. `rev` is the commit's parent (commit source), `baseRef ?? HEAD`
  (working tree), or the re-resolved merge-base (branch range). For a commit it re-checks `baseRef === parent`, else
  errors *"Selected commit changed. Refresh the comparison."*
- New side: for a commit, `git show sha:path`; otherwise it **reads the working-tree file from disk** (Core:3575-3641)
  with realpath containment checks, a check against server-internal paths, and a regular-file-only check.
- Limits: 1 MiB. Content containing a NUL byte fails with *"Cannot expand binary file"*. The new side is UTF-8 decoded.

---

## 2. VCS status: `vcs.refreshStatus`, `subscribeVcsStatus`

### Shape (`packages/contracts/src/git.ts:210-276`)
Status has two halves that are cached separately:
- **local**: `isRepo, sourceControlProvider?, hasPrimaryRemote, isDefaultRef, refName|null, hasWorkingTreeChanges,
  workingTree:{rootPath?, files:[{path,insertions,deletions}], insertions, deletions},
  branchChanges?: {baseRef|null, insertions, deletions}`.
- **remote**: `hasUpstream, aheadCount, behindCount, aheadOfDefaultCount?, pr: {number,title,url,baseRef,headRef,state,isDraft?,updatedAt?}|null`.
- Stream events: `snapshot{local,remote}`, `localUpdated{local}`, `remoteUpdated{remote}` (git.ts:266-276).
  The default branch name itself is not sent; only `isDefaultRef` is.

### Local read: `readStatusDetailsLocal` (Core:2078-2341), called with `{includeDivergence:false, includeBranchChanges:true}` (GM:1117-1137)
1. `["rev-parse","--git-path","index"]`. **If `<index>.lock` exists, it fails with "Git index is locked. Status will
   resume when the index lock is removed."** (Core:2101-2124). The reason given: status can still succeed while locked,
   but then it reruns LFS clean filters.
2. These run concurrently:
   - `["status","--porcelain=2","--branch","-z","--no-ahead-behind"]` (LC_ALL=C)
   - `["diff-index","-M","--numstat","-z","HEAD","--"]`. Plumbing is used on purpose: *"Porcelain diff rewrites indexes
     despite GIT_OPTIONAL_LOCKS=0"* (Core:2148). Unborn HEAD: `diff-files --numstat -z` + `diff --cached --numstat -z`.
   - The default branch: `["--git-dir",commonDir,"symbolic-ref","refs/remotes/origin/HEAD"]`, **cached 5 min per common dir** (Core:1528-1553).
   - Has a remote: `["--git-dir",commonDir,"remote"]`, cached 5 min (Core:1554-1574).
3. It parses the porcelain v2 records `# branch.head`, `# branch.upstream`, and the change records; `?` records give
   the untracked roots. Rename records also list the original path.
   Untracked files appear in `files` with 0/0 counts (Core:2324-2328).
4. `isDefaultRef` = branch == origin/HEAD's branch, or main/master when origin/HEAD is missing (Core:2276-2279).
5. `branchChanges` (`readBranchChangeTotals`, Core:3139-3200): the merge base as in section 1 (no `allowRemoteOfCurrent`),
   the untracked temp index limited to the untracked roots (only when there are <= 128 roots and < 8 KB), then
   `[...REVIEW_DIFF_ARGS,"--numstat","-z",mergeBase,"--"]` summed. This is the "+X −Y vs main" total.
6. The GitManager result cache has a **1 s TTL** (GM:166, 1138-1141).

### Remote read: `readStatusDetailsRemote` (Core:1975-2076) + PR lookup (GM:1381-1420)
- `["rev-parse","--symbolic-full-name","HEAD"]`, `["rev-parse","--abbrev-ref","--symbolic-full-name","@{upstream}"]`,
  `["rev-list","--left-right","--count","HEAD...<upstream>"]`.
- Without an upstream: ahead = `["rev-list","--count","--end-of-options","<baseRef>..HEAD"]` (Core:1951-1973).
- `aheadOfDefaultCount` is computed the same way against the resolved base.
- Before reading, `refreshStatusUpstreamIfStale` (Core:1643-1656) may **fetch the upstream's remote**:
  ```ts
  ["--git-dir", gitCommonDir, "fetch","--quiet","--no-tags","--no-auto-gc","--", remoteName]   // Core:1339-1348
  ```
  It is single-flight per (commonDir, remote) and cached for **15 s** (Core:89). Failures back off from 30 s, doubling
  up to 15 min (Core:93-94, 137-142). The status read waits at most 5 s for the fetch and otherwise uses the old refs
  (Core:1382-1391). `--no-auto-gc` is there so a failing auto-gc can't keep leaving `tmp_pack_*` files until the disk
  fills (comment Core:1335-1338).
- PR: looked up through the hosting provider's API, cached 60 s (5 min when there is no PR), with failure backoff (GM:168-172).

### Keeping it fresh (Bc)
- **No filesystem watcher for status.** Freshness comes from:
  1. A **remote poll loop per cwd while anyone is subscribed** (`makeRemoteRefreshLoop` Bc:562-641, `retainRemotePoller` Bc:643-690).
     The interval is the `automaticGitFetchInterval` setting, default **30 s** (`packages/contracts/src/settings.ts:944`).
     Failures back off 30 s → 15 min. It is gated by `BackgroundPolicy.shouldRunScopeWork({type:"vcs-status"})`
     (Bc:580-590), and each tick also refreshes local (Bc:487). Setting the interval to 0 turns fetches off; then it
     only does the initial refresh.
  2. **At the end of every turn**: `RunFinalizationService.ts:103-105` calls `vcsStatus.refreshLocalStatus(cwd)`, then
     `refreshPullRequestStatus` when the thread is on a non-default branch.
  3. **After every mutation** in `ws.ts:2990-3043` (`refreshGitStatus`, ws.ts:1857-1860, forked and detached): pull,
     runStackedAction, createRef, switchRef, create/remove worktree, init.
  4. Explicit `vcs.refreshStatus {cwd, localOnly?}` (ws.ts:2995) from the client: the branch selector
     (`BranchToolbarBranchSelector.tsx:508`, localOnly), the git actions control, and thread actions.
- Publishing: each half gets a JSON-string fingerprint, and an event is published only when it changes (Bc:257-310).
  A remote result for a different branch than local is dropped. Local refreshes are coalesced: a refresh that started
  after your request satisfies it (Bc:364-394). Remote writes hold a per-cwd lock, so a slow poll can't overwrite a PR
  that a turn end just found (Bc:251-257).
- Auto-pull (opt-in per project, `defaultAutoPull`): only when on the default branch with a clean tree, ahead == 0 and
  behind > 0 (Bc:414-470).
- Cost of a local refresh: roughly 4-6 git spawns when caches are warm (rev-parse index, status, diff-index, plus the
  merge-base/ls-files/numstat chain for branchChanges, which spawns 5-8 more: config reads, show-ref, merge-base,
  ls-files, temp-index add -N, diff --numstat). The broadcaster cache means subscribers don't trigger this; only
  refresh triggers do.

---

## 3. listRefs / switchRef / createRef

### listRefs (Core:3813-4116)
- Snapshot per `gitCommonDir`, so all worktrees share it. The commands run in parallel, 2 at a time:
  ```ts
  ["--git-dir",commonDir,"for-each-ref","--format=%(refname)%09%(committerdate:unix)%09%(symref)%09%(upstream)","refs/heads","refs/remotes"]  // 30s, 16MiB
  ["--git-dir",commonDir,"symbolic-ref","refs/remotes/origin/HEAD"]                                         // default
  ["--git-dir",commonDir,"worktree","list","--porcelain","-z"]  (falls back to no -z for git < 2.36, Core:1219-1233)
  ["--git-dir",commonDir,"remote"]
  ```
- It lists local and remote branches (no tags), drops symrefs like `origin/HEAD`, sorts by **committer date desc**,
  then name. That recency sort is the "recent" ordering. Each ref is `{name, isRemote, remoteName?, upstreamRef?,
  current, isDefault, worktreePath}`. Worktree paths that no longer exist are filtered out.
- The final order is current first, then default, then the rest (Core:4085-4089). By default a remote ref with a
  matching local branch is deduped (`dedupeRemoteBranchesWithLocalMatches`). Filters: `refKind` (all/local/remote) and
  a case-insensitive substring `query`. Pagination uses `cursor` and `limit` (default 100, max 200).
- Cache: snapshot TTL 2 min. `refresh:true` re-reads, coalesced within 5 s, with a 30 s failure cooldown (Core:103-106).
  Invalidated after any mutation through `withListRefsInvalidation` (Core:4941-4952).

### switchRef (Core:4765-4856)
- Probes: `["show-ref","--verify","--quiet","refs/heads/<ref>"]` and `["show-ref","--verify","--quiet","refs/remotes/<ref>"]`.
  For a remote ref with no local branch, it looks for a local branch tracking it:
  `["for-each-ref","--format=%(refname:short)\t%(upstream:short)","refs/heads"]`.
- Then one of:
  `["checkout",ref,"--"]` | `["checkout","--track",remoteRef,"--"]` | `["checkout",localTrackingBranch,"--"]`.
  The trailing `--` is there so *"A stale ref must not turn into a path checkout that discards local edits."* LC_ALL=C,
  10 s timeout.
- **Dirty tree: no stash and no pre-check.** Git's own refusal ("would be overwritten") comes back as a
  GitCommandError with the generic detail `"git checkout failed"`. The stderr is not shown. The web shows a toast.
- Result: `["branch","--show-current"]` gives `{refName}`.
- It is wrapped in a per-checkout **workspace lease** (an in-process semaphore keyed by realpath,
  `apps/server/src/workspace/workspaceLease.ts`, used at `GitWorkflowService.ts:181-185, 304-309`). The same lease
  guards turn start (`ProviderTurnStartService.ts:1719`) and rollback, so a branch switch can't happen mid-turn.

### createRef (Core:4858-4872)
`["branch","--",refName]` (10 s, shared-config lock, because `branch.autoSetupMerge=always` writes config), then
`switchRef` if `switchRef:true`. Name collisions fail with `branch_already_exists`.
(The separate `createBranchAt`, Core:3726-3757, used for worktrees, does `["branch","--no-track","--",b,start]` and then
`["branch","--set-upstream-to=<refs/remotes/...>","--",b]` with config-lock retry.)

---

## 4. `git.runStackedAction` (GM:3039-3238)

Input: `{actionId, cwd, action: commit|push|create_pr|commit_push|commit_push_pr, commitMessage?, featureBranch?, filePaths?, threadId?, projectId?}`
(git.ts:126-135). Transport: a WS stream of `GitActionProgressEvent` (ws.ts:3006-3043).
Event kinds: `action_started{phases}`, `phase_started{phase,label}`, `hook_started/hook_output/hook_finished`,
`action_finished{result}`, `action_failed{phase,message}` (git.ts:428-494). The whole action holds the checkout lease
(`GitWorkflowService.ts:378-386`).

Steps:
1. `statusDetails(cwd)`, which includes the upstream fetch check. Push is needed for push/commit_push/commit_push_pr,
   and for `create_pr` when there's no upstream or ahead > 0. PR is needed for create_pr/commit_push_pr.
   It errors on a detached HEAD for push or PR, and on `featureBranch` without a commit action.
2. The text model comes from `settings.sourceControlWriterModelSelection ?? textGenerationModelSelection`. The default
   is **Codex `gpt-6-luna`, reasoningEffort `low`** (`packages/contracts/src/settings.ts:1314-1325`, `model.ts:135-138`).
   The style setting defaults to `repo_conventions`.
3. **Branch phase** (if `featureBranch`), "Preparing feature branch..." (`runFeatureBranchStep`, GM:3002-3037): it
   generates the subject, body, and branch together (`includeBranch:true`), then
   `resolveAutoFeatureBranchName(existing, suggestion.branch ?? sanitize(subject))`
   (`packages/shared/src/git.ts:57-91`). The fragment is lowercased, NFKD-folded, and limited to `[a-z0-9/_-]` and 64
   chars. With no `/` it gets the prefix **`feature/`**. Collisions get `-2`, `-3`, and so on; the fallback is
   `feature/update`. Then `git branch -- <name>` and `git checkout <name> --`. The dirty tree carries over to the new
   branch.
4. **Commit phase** (`runCommitStep`, GM:2120-2232):
   - Context (`prepareCommitContext`, Core:2472-2557) is built in a **temp index copy** (`t3code-commit-index-*`), so a
     failed generation never touches the real index:
     `update-index --no-split-index` → staging (below) → `["diff","--cached","--name-status"]`. If that's empty the step
     returns `skipped_no_changes`. Otherwise
     `["diff","--no-ext-diff","--no-textconv","--cached","--patch","--minimal"]` capped at 49 KB.
   - **Staging rules** (`stageCommitChanges`, Core:2402-2470): with no `filePaths` it's **`["add","-A"]`, everything
     except .gitignored files, with no extra exclusions**. With `filePaths` on the real index it refuses during a merge
     (`MERGE_HEAD`), runs `["reset","--quiet"]`, then
     `["add","-A","--",":(top,literal)<f>"...]`. So selected-file commits **unstage everything else first**.
   - A custom `commitMessage` skips generation: first line = subject, rest = body (GM:541-557).
   - **Prompt** (`packages/provider-core/src/server/textGenerationPrompts.ts:25-67`), verbatim:
     ```
     You write concise git commit messages.
     Return a JSON object with keys: subject, body[, branch].
     Rules:
     - subject must be imperative, <= 72 chars, and no trailing period
     - body can be empty string or short bullet points
     [- branch must be a short semantic git branch fragment for this change]
     - capture the primary user-visible or developer-visible change
     [\nAdditional instructions:\n<policy.commitInstructions>]

     Branch: <branch|(detached)>

     Staged files:
     <name-status, ≤6000>

     Staged patch:
     <patch, ≤40000>
     ```
     Output schema `{subject, body[, branch]}`. The policy (GM:806-866):
     - `repo_conventions`: *"Follow the repository's established commit message style when examples are available."*
       plus the last 20 non-merge subjects (`["log","-n","20","--no-merges","--pretty=format:%s"]`, GM:789-804), plus
       `AGENTS.md` (≤20 KB), plus `CLAUDE.md` when the writer is Claude and the file differs.
     - `conventional_commits`: *"Use Conventional Commits when generating commit subjects. Prefer the narrowest accurate type and include a scope only when it is obvious from the diff."*
     - `custom`: the user's instructions.
     (`apps/server/src/textGeneration/TextGenerationPresets.ts`)
   - Sanitize (GM:490-507): first line, strip trailing dots, slice to 72, fallback `"Update project files"`.
   - The commit runs on the real index: re-stage (same rules), then `["commit","-m",subject,("-m",body)]`. 10 min
     timeout, **hooks run**, and hook output is streamed via trace2 (`hook_*` events, sanitized to 500 chars). Then
     `["rev-parse","HEAD"]`.
5. **Push phase**, "Pushing..." (`pushCurrentBranch`, Core:2621-2795; GM:736-747):
   - With ahead == behind == 0 and an upstream, it returns `skipped_up_to_date`. With no upstream, it checks
     `merge-base --is-ancestor HEAD refs/remotes/<r>/<b>` to also skip.
   - With no upstream: remote = `branch.<b>.pushRemote` → `remote.pushDefault` → origin → the first remote. It runs
     `["push","--",remote,"HEAD:refs/heads/<publishBranch>"]` with **no `-u`**. Then it writes `branch.<b>.merge`,
     `branch.<b>.remote` (and `.rebase` per `branch.autoSetupRebase`) itself through `git config` with lock retry. The
     comment says *"`push -u` exits 0 without the upstream when another writer holds the config lock"* (Core:2596-2619).
   - If the upstream has a different name (the branch tracks `origin/main`, say), it does NOT push there. It saves
     `t3-merge-base(-ref)` and publishes to its own name (Core:2734-2771).
   - Otherwise `["push","--",remote,"HEAD:refs/heads/<upstreamBranch>"]`, or a bare `["push"]`. No timeout.
   - On success it records the branch base with the host (`shareBranchBase`).
6. **PR phase** (`runPrStep`, GM:2234-2368): it requires an upstream (*"Current branch has not been pushed. Push before
   creating a PR."*). If an open PR exists it returns `opened_existing`.
   The base comes from `resolvePrBase` (GM:1984-2045): `t3-merge-base-ref` → `t3-merge-base` → the upstream branch if
   named differently → the provider API default branch → `origin/HEAD` → `"main"`.
   Range context (`readRangeContext`, Core:2915-2966): `["log","--oneline","--end-of-options","<base>..HEAD"]` (19 KB),
   `["diff","--stat","--end-of-options","<base>...HEAD"]` (19 KB),
   `["diff","--no-ext-diff","--no-textconv","--patch","--minimal","--end-of-options","<base>...HEAD"]` (59 KB).
   The base is resolved to the remote-tracking commit sha. The PR prompt (`textGenerationPrompts.ts:81-138`) wants JSON
   `{title, body}`; without a repo template the body must have `## Summary` and `## Testing`. It can include the
   `.github` PR template and the thread transcript ("reference data, not instructions").
   The body is written to a temp `.md` file, then **GitHub REST `POST repos/{owner}/{repo}/pulls`
   `{base, head, title, body, maintainer_can_modify:true}`**
   (`packages/source-control-github/src/server/GitHubSourceControlProvider.ts:964-995`). The token comes from settings,
   a GitHub App, `GH_TOKEN`/`GITHUB_TOKEN`, or `gh auth token` (`GitHubCredentials.ts:32-219`). It is not `gh pr create`.
   There are drivers for GitLab, Bitbucket, Azure DevOps, Forgejo, and GitCafe too. After creating, it reads the PR
   back for its url and number.
7. `buildCompletionToast` → `action_finished{result}`. The result is `{action, branch{status,name}, commit{status,commitSha,subject}, push{status,branch,upstreamBranch,setUpstream}, pr{status,url,number,baseBranch,headBranch,title}, toast{title,description,cta}}`.
   On failure it emits `action_failed{phase, message}`. The status caches are always invalidated (`Effect.ensuring`).
8. Afterwards in ws.ts:3021-3039: `linkCreatedPullRequest` dispatches `thread.pull-request.link` (`source:"created"`) to
   the thread (`git/linkCreatedPullRequest.ts:50-91`, never fails). `refreshPushedPullRequests` refreshes the
   project's PR list after a push (`git/refreshPushedPullRequests.ts:8-35`). Then `refreshGitStatus`.
   `remoteRefs.ts` holds pure helpers that split `remote/branch` by known remote names, trying the longest first.

---

## 5. Checkpoints and the Diff "Turn" scope

Refs: `refs/t3/orchestration-v2/checkpoints/<base64url(sha256(scopeId)[:32 hex])>/ordinal/<n>`
(`orchestration-v2/CheckpointService.ts:26, 149-160`). Ordinal 0 = thread start, n = after run n.

**Capture** (`Drv:899-1243`), a full worktree snapshot as a commit that **never touches the user's index, HEAD, or branch**:
- `["rev-parse","--path-format=absolute","--git-common-dir","--git-path","index","--verify","--quiet","HEAD"]`
  (one spawn, Drv:842-878).
- The temp index lives at `<gitCommonDir>/t3-checkpoint-index-<uuid>` with env `GIT_INDEX_FILE` and
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` = `T3 Code <t3code@users.noreply.github.com>`, plus index config
  `-c core.fsmonitor=false -c sparse.expectFilesOutsideOfPatterns=false -c core.splitIndex=false -c splitIndex.sharedIndexExpire=never`.
- Fast path: copy the user's index (for stat cache reuse), then `read-tree --reset HEAD`, restore mtime-1s, and check
  for special flags with `ls-files --full-name --sparse -v -z`. Otherwise `read-tree HEAD` fresh.
  Sparse-checkout handling is involved. Non-cone sparse is refused.
- `["add","-A","--","."]` (or `-u` if the workspace dir is gitignored), with durable-write flags
  `-c core.fsync=objects,reference -c core.fsyncMethod=fsync` (Drv:884-892). If that fails, it excludes nested repos
  that have no commits and retries.
- `["write-tree"]` → `["commit-tree",tree,"-p","HEAD","-m","t3 checkpoint ref=<ref>"]`. **HEAD is the parent**, so
  later code can tell whether HEAD moved. Then `["update-ref",ref,commit]`. The temp index and its `.lock` are always
  removed.
- When: the baseline is captured before the provider turn starts (`RunExecutionService.ts:933-950`, ordinal `run-1`;
  skipped for side chats). The after-turn capture runs in `CheckpointCaptureService.ts:60-160` (ordinal = run ordinal).
  After capturing it computes `files` via a numstat diff against the previous ordinal and stores them on the checkpoint
  event. That is what feeds the per-turn file list without running a diff later.
- A per-cwd lock serializes capture, restore, and delete (`CheckpointService.ts:243-245`).

**Diff** (`Drv:1338-1410`):
```ts
["-c","diff.relative=false","diff", ("--numstat","-z") | "--patch", "--no-color","--no-ext-diff","--no-textconv","--src-prefix=a/","--dst-prefix=b/", ("--ignore-all-space"), `${from}^{commit}`, `${to}^{commit}`, ("--", ":(top,literal)f"...)]
```
Limit 10 MB (`CHECKPOINT_DIFF_MAX_OUTPUT_BYTES`, `VcsDriver.ts:25`).

**"Authored paths"** (`listAuthoredPaths`, Drv:1412-1465), which filters out files the agent didn't write (pull/rebase
mid-turn). `log --no-walk=unsorted --format=%P %ct from to` gives each checkpoint's parent HEAD. If HEAD didn't move,
it returns null (every changed path belongs to the turn). Otherwise it unions `diff startHead from`,
`diff endHead to`, and `log --diff-merges=remerge` over the HEAD moves, all with `--name-only -z --no-renames`. Changed
files not in that set are treated as git imports and dropped (`checkpointing/Diffs.ts:37-45`).

**getTurnDiff / getFullThreadDiff** (`checkpointing/CheckpointDiffQuery.ts:89-312`): the Diff panel's "Turn N" /
"Latest turn" scope calls `getTurnDiff{threadId, fromTurnCount: N-1, toTurnCount: N, ignoreWhitespace (default true)}`
(web `DiffPanel.tsx:343`). It maps turn counts to checkpoint refs (from = the previous ordinal in the same scope, or the
root scope's ordinal 0 when from == 0), takes numstat plus authored paths, and keeps the retained files. If any were
dropped, the patch is generated only for the kept paths, in batches of at most 24,000 pathspec chars. The result is
truncated to 10 MB with `[truncated]`. It returns `{threadId, fromTurnCount, toTurnCount, diff: patchText}`, again raw
patch text. `getFullThreadDiff` = `getTurnDiff(0 → N)`.

**Cost**: capture is about 6-10 spawns, and `add -A` over the whole tree is the expensive part. It is cheap on a warm
stat cache, thanks to the index copy and the mtime trick. A turn diff is 4-6 spawns. **Cleanup**: refs are deleted only
for checkpoints made stale by a **rollback** (`["update-ref","-d",ref]`, Drv:1467-1482;
`CheckpointRollbackService.ts:292-294`). I found no GC of refs on thread delete or archive. The refs keep their
objects alive.
**Restore** (Drv:1250-1336): `restore --source <c> --worktree --staged -- .`, then `clean -fd -- .`, then `reset --quiet -- .`.

---

## 6. How T3 avoids clashing with the user's own git

- `GIT_OPTIONAL_LOCKS=0` on every core command, and `diff-index` instead of porcelain `diff` for status.
- Status refuses to run while `index.lock` exists.
- Anything T3 stages for its own use goes through a temp `GIT_INDEX_FILE`: the review untracked index (`add -N`), the
  commit-message context, and checkpoints. The real index is written only by the user-initiated commit and by
  restore/rollback.
- Config writes take an in-process lock per common dir and retry on `config.lock`.
- Background fetch: `--no-auto-gc`, no tags, no prompts, single-flight, with backoff. `pull` waits for a pending status
  fetch (Core:2826-2833) and retries just the upstream when it hits a ref-lock race.
- Branch mutations, turn start, and rollback share one workspace lease per checkout realpath.
- Global spawn caps: 8 short commands, 4 background fetches.
- `safe.bareRepository=explicit` via env config. `--end-of-options`, `--`, and `:(top,literal)` everywhere. No user
  diff drivers or textconv (`--no-ext-diff --no-textconv`), and forced `a/` `b/` prefixes.

---

## 7. Notes for Banda's Rust engine (tokio::process)

- Build one `run_git(op, cwd, args, opts)` first. It should set the env (`GIT_OPTIONAL_LOCKS=0`, optional `LC_ALL=C`,
  `GIT_TERMINAL_PROMPT=0` for background work, `GIT_CONFIG_COUNT` injection), apply a timeout with kill-on-drop, cap
  output with a truncation flag, take a semaphore, and classify stderr into a fixed enum without sending stderr on.
- The diff panel needs only two calls: `diff_preview` (two sources: worktree-vs-HEAD and worktree-vs-merge-base, plus
  `--numstat -z` file lists and raw patch text) and `file_contents`. Copy the temp-index + `add -N` trick for untracked
  files, with the 5,000-file cap.
- Base detection: config key → `origin/HEAD` → main/master. T3 never reads `init.defaultBranch`. Store Banda's own
  `branch.<b>.banda-merge-base` the way T3 stores `t3-merge-base`.
- Status: `status --porcelain=2 --branch -z --no-ahead-behind` + `diff-index -M --numstat -z HEAD`, refreshed on turn
  end, after mutations, and on an explicit request. Do remote fetches in a separate poll (30 s, only while subscribed).
  No fs watcher is needed to match T3.
- Turn diffs: `write-tree`/`commit-tree -p HEAD` checkpoint refs under a private namespace (e.g. `refs/banda/...`),
  with the temp index in the common dir. Plan the ref GC that T3 doesn't have.
