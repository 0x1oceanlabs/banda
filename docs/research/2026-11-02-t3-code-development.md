# Development in T3 Code: Diff, Files, Pull Requests, side chat, git

What T3 Code gives a Person who writes code next to a Thread, and how much of it
Banda has. The aim is to take each part as **a module in its own Pane** (as
memory and ADR 0024 already say), opened from a Thread's messages or by an
Agent.

- **Source:** github.com/pingdotgg/t3code, clone at `/tmp/t3src/t3code`.
- **Commit:** `ac8dce0cc3abd8a337f2d806b5082a6834b9b81a`, 2026-11-02T06:38:34-08:00 ("fix(marketing): show 40k+ GitHub stars (#29362)").
- **How:** read-only. Nothing from T3 was run. Paths are relative to the repo root; web paths are under `apps/web/src/`. Line numbers are at that commit.
- **Banda:** `main` at `0321a29`.

## 0. The shape in one picture

T3 puts development next to the chat in three places, all of which can be open at once:

```
+-----------+--------------------------------+------------------------------+
| sidebar   | chat (Thread)                  | right panel: one tab strip   |
| threads,  |                                | Diff | Files | a.ts | #231 | |
| PR badge  |                                | Pull requests | Side chat |  |
|           |                                | Terminal | Browser | Device  |
|           +--------------------------------+                              |
|           | terminal drawer (mod+j)        |                              |
+-----------+--------------------------------+------------------------------+
                  thread details panel (mod+shift+b): branch, worktree,
                  PR, git actions, changes, side chats
```

Banda has no panels inside a Pane: each of these becomes a Pane in the Strip,
beside the Thread.

## 1. The right panel, T3's frame for all of it

- **Surface kinds:** `diff | files | file | preview | device | terminal | pull-request | pull-requests | side-chat` (`rightPanelStore.ts:15-25`).
- **One or many:** `diff`, `files` and `pull-requests` exist once per thread. `file:<path>`, `terminal:<id>`, `pull-request:<n>` and `browser:<id>` can have many tabs.
- **State:** kept per thread under `environmentId:threadId`, persisted as `t3code:right-panel-state:v2` (`rightPanelStore.ts:81-106`). Each surface gets the thread and the environment; its folder is `thread.worktreePath ?? project.workspaceRoot` (`components/chat/ChatView.tsx:1703`).
- **Empty panel:** a launcher titled "Open a surface" with one-key choices: B Browser, T Terminal, F Files, D Diff, P Pull request, L Linked pull requests, M Device, S Side chat (`components/RightPanelTabs.tsx:341-405,478`).
  - An entry that cannot open says why, for example "Diff is only available for server threads in Git repositories." (`:176-207`).
- **Tab menu:** "Rename", "Copy path", "Close", "Close others", "Close to the right", "Close all" (`:1185-1215`).
- **Other controls:** "Maximize panel" / "Restore panel size". Below 980 px the panel becomes a sheet.
- **Opening by itself:**
  - After a turn ends, the panel opens that turn's diff. When a PR is linked, it opens the PR.
  - It never overrides a choice the Person made.
  - It is off by default: `proactivePanelsEnabled` (`packages/contracts/src/settings.ts:476`; `hooks/useProactivePanels.ts`).
- **Keys** (`packages/shared/src/keybindings.ts:156-219`):

  | Key | What it does |
  | --- | --- |
  | mod+alt+b | panel |
  | mod+shift+b | thread details |
  | mod+j | terminal |
  | mod+d | diff |
  | mod+t | new tab |
  | mod+w | close tab |
  | mod+shift+t | reopen closed |
  | mod+p | file picker |
  | mod+shift+f | search in project |
  | mod+shift+g | branch |
  | mod+shift+k | copy PR number |
  | mod+o | open in favourite editor |

## 2. Diff

- **Files:** `components/DiffPanel.tsx`, `diffPanelStore.ts:16-23`, `components/diffs/*`.
- **What it diffs**, chosen per thread in the "Diff scope" menu (`DiffPanel.tsx:796-947`):
  - "Changes": the branch against a base ref. This is the default.
  - "Uncommitted": the working tree.
  - "Latest turn", and "Turn N" in a submenu.
  - "Commits": one commit of the branch ("No commits on this branch.").
  - "Tool call": reached from the timeline.
- **Base ref:** a combobox ("Search refs...", "Automatic", "Branch" / "Remote", "Remote only"; `:960-1074`).
- **Toolbar** (`:1109-1243`): "Refresh diff", "Expand all files" / "Collapse all files", "Stacked diff view" / "Split diff view", line wrapping, "Hide/Show whitespace changes", "Hide test files", "Show/Hide file tree".
- **Line comments:** select lines → "Add a comment…" → "Comment" (`components/diffs/DiffCommentAnnotation.tsx:40-106`).
  - The comment is not stored on the server. It becomes a chip in the composer (`ReviewCommentContext`; `composerDraftStore.ts:589`) and goes to the Agent with the next message.
- **A file:** click opens it in a `file` tab. Its menu has "Open", reveal, "Open with"; there is a copy-path button. **There is no per-file revert.**
- **Data:**
  - **Turns** come from checkpoints, not live git: `orchestration.getTurnDiff` and `orchestration.getFullThreadDiff`, with input `{threadId, fromTurnCount, toTurnCount, ignoreWhitespace}` (`packages/contracts/src/checkpointDiff.ts`; server `checkpointing/CheckpointDiffQuery.ts`).
  - **Git:** `review.getDiffPreview` (sources `working-tree`, `branch-range`, `commit`), `review.getBranchCommits` and `review.getDiffFileContents` (`packages/contracts/src/review.ts`; server `review/ReviewService.ts`).
  - **Status:** `vcs.refreshStatus` and `subscribeVcsStatus`.

## 3. Files

- **Files:** `components/files/FileBrowserPanel.tsx`, `FilePreviewPanel.tsx`, `FileExplorerPane.tsx`, `ProjectFilePicker.tsx`, `components/search/ProjectContentSearchDialog.tsx`.
- **The tree:** "Search files", "Refresh files", "Expand/Collapse all folders". A file's menu has "Copy mention" and "Add to chat".
- **A file:**
  - It is an **editable** code view that saves itself 500 ms after the last key, through `projects.writeFile` (`fileSaveSessions.ts:140-154`).
  - It is read-only when the file was truncated or the connection cannot write ("Read-only connection. Unsaved edits are kept until write access returns.").
  - Line comments work as in the Diff.
  - Rendered views exist for markdown, Mermaid, HTML, tables, PDF, Office files, images, audio and fonts.
  - Buttons: "Copy contents", "Save file", "Open file in preview browser".
- **Search:** mod+p ("Search files…") and mod+shift+f ("Search in {project}" with case, whole word and regex).
- **External editor:** "Open in {editor}" / "Choose editor" (`components/chat/OpenInPicker.tsx:287-418`). The editors are listed in `packages/contracts/src/editor.ts`: Cursor, VS Code, Zed, JetBrains IDEs, the file manager, and others.
- **RPCs:** `projects.listEntries`, `readFile`, `writeFile`, `searchEntries`, `searchContents`, `shell.openInEditor`, `assets.createUrl`.

## 4. A pull request

- **Files:** `components/pullRequest/PullRequestDetailPanel.tsx` (tabs at `:200-203`), `PullRequestSummaryTab.tsx`, `PullRequestCodeTab.tsx`, `PullRequestTimelineTab.tsx`, `PullRequestGuideTab.tsx`, `PullRequestReviewForm.tsx`.
- **Tabs:**
  - **Summary:** "Reviewers", "Labels", "Description", "Checks" (with refresh), "Comments (N)", "Copy checkout command".
  - **Code:** the diff by commit ("All commits"), a "Viewed" tick per file, and the Diff's view toggles. Review threads sit inline. A new line comment goes either to "Add to review" or to "Add to agent".
  - **Timeline:** comments, reviews and commits ("Newest first" / "Oldest first", "Outdated", "Review dismissed").
  - **Guide:** a tour of the change written by an Agent (section 5). It is off by default.
- **Actions** (`packages/contracts/src/pullRequest.ts:60-72`): `merge` (merge, squash or rebase), `ready`, `draft`, `close`, `reopen`, `delete-branch`, `update-branch`, `enable-auto-merge`, `disable-auto-merge`, `revert`, `approve-workflows`.
  - Labels: "Merge now" → "Confirm merge?", "Enable auto-merge", "Ready for review" / "Convert to draft", "Check out" (in a "Local" or "Worktree" checkout), "Resolve conflicts", "Approve workflows to run", "Ask a question", "Explain this PR".
  - Review: "Comment" / "Approve" / "Request changes" → "Submit review".
- **RPCs:** `pullRequests.list`, `detail`, `checks`, `activity`, `threadComments`, `diffFileContents`, `filesViewed`, `setFilesViewed`, `runAction`, `update`, `comment`, `submitReview`, `replyToThread`, `setThreadResolution`, `requestReviewers`, `setLabels`, `reviewGuide`, `generateReviewGuide`, `stack` and `subscribeRefreshes` (`packages/contracts/src/rpc.ts`). Also `git.resolvePullRequest` and `git.preparePullRequestThread`.
- **A whole page** lists PRs: `components/pullRequest/PullRequestsPage.tsx`, route `/pull-requests`.

## 5. Pull requests linked to a Thread

- **A link** (`packages/contracts/src/threadPullRequest.ts:115`) holds:
  - `host`, `repository`, `number`, `url`;
  - `source`, one of `manual | created | agent | stack | stack-dismissed`;
  - `linkedAt`;
  - a `snapshot`: state, title, head/base, draft, merged or closed time, author, +/−, review decision, checks state, mergeability;
  - the `stack`;
  - an optional `watch`.

  Links live on `thread.pullRequests`.
- **How a link is made:**
  - The Person pastes a URL or `#42` ("Link pull request").
  - The Agent calls `link_pull_request`.
  - A PR created from the Thread's shell is linked by itself (`source: created`; it is matched against the host's `changeRequestCreateCommand`, `PullRequestSyncReactor.ts:645`).
  - The other layers of a stack are linked too.
  - A sync sweep runs every minute.
- **Where it shows:**
  - A badge with the PR number on the sidebar row and in the branch toolbar (`+N` when there are several). Hovering lists them (`ThreadStatusIndicators.tsx:205`; `SidebarThreadRow.tsx:1048-1066`).
  - A "Pull requests" tab, launched as "Linked pull requests" (`ThreadPullRequestsPanel.tsx`):
    - each link's source: "Linked by you", "Created from this thread", "Linked by the agent", "Found in the stack";
    - a link's menu: "Watch for changes" / "Stop watching", "Unlink from thread" / "Dismiss from thread";
    - empty state: "No linked pull requests".
- **Agent tools** (`apps/server/src/mcp/toolkits/pullRequests/tools.ts`):
  - `link_pull_request` ("Link a PR to this thread. T3 shows its status and settles the thread on merge.") and `link_pull_requests`;
  - `unlink_pull_request` and `unlink_pull_requests`;
  - `list_thread_pull_requests`;
  - `watch_pull_request` and `unwatch_pull_request` (hidden from subagents);
  - `write_pull_request_guides` and `read_pull_request_guide`.
- **Watching:**
  - Every 2 minutes, `PullRequestWatchReactor.ts` looks at each watched PR. `evaluatePullRequestWatch` (`pullRequestWatch.ts:34`) reports:
    - `checks-failed`;
    - `checks-passed` (the required checks, or all checks when none are required);
    - `remarks` (new comments or reviews);
    - `no-checks` (nothing 15 minutes after the head was first read);
    - `conflicting`.
  - Any change wakes the Agent with a queued message: "Update on pull request #N (url), which T3 Code is watching for you:", followed by bullets (`pullRequestWatchMessage`, `:217`).
  - A watch ends:
    - on merge, silently;
    - on close, with a message;
    - when the Thread settles;
    - after 10 wakes in a row that only bring comments.
- **Settling on merge** (`ThreadSettlementService.ts:120-238`):
  - A Thread settles (it leaves the active list) when all its links are finished and the latest one merged, or when they closed.
  - It does not settle when pinned, snoozed, asking, or still working.
  - Setting: "Auto-settle merged threads", default on.
- **Guide:** a `PullRequestReviewGuide` holds `{headSha, stops[]}`. Each stop has a title, summary, `attention` (tradeoff, contract, product, risk or accessibility), excerpts, files, notes and questions.
  - It is written by a text model in a temporary detached worktree.
  - It is off by default ("Add a Guide tab to pull requests. An agent explains the changes and points out decisions that need review.").

## 6. Side chat

- **What it is:** a separate thread forked from the main one: `thread.fork` with `sideChat: true`, `sourcePoint: latest_stable`, `title: "Side chat"` (`apps/web/src/components/chat/useSideChat.ts:43`; `apps/server/src/orchestration-v2/ThreadForkService.ts:117-123`).
  - Its lineage reads `{relationshipToParent: "fork", sideChat: true, parentThreadId}`.
  - It is **hidden from thread lists**.
  - It shares the parent's worktree and keeps the parent's PR links, but not their watches.
  - It starts in `approval-required` mode.
- **Context:** its first turn gets a digest of the main thread, up to 8,000 characters. The digest begins "You are in a side chat beside the main thread… do not continue or redo the main thread's task." (`ContextHandoffService.ts:245-280`).
- **How to open one:**
  - Composer commands `/side [prompt]` and `/btw` ("Ask a side question in a new side chat").
  - The launcher entry "Side chat" (S): "Ask a side question while this thread keeps working."
  - It is text only, and only after the first message. A side chat cannot start another side chat.
- **Its tab:** a title, **"Bring back"**, "Delete side chat", "Close side chat", and the chat itself.
  - "Bring back" runs `thread.merge_back`: "Adds this side chat to the main thread's next message." It is offered only when the main thread is idle.
  - Closing a side chat that never ran deletes it.
- **In the thread details:** listed under "Side chats · N running".

## 7. Git: branch, worktree, commit, push, PR

- **Where:** the thread details panel, section "Version Control" (`components/chat/ThreadDetailsPanel.tsx:215-238`). Its parts can be hidden: "Environment and worktree", "Open in editor", "Branch and pull request", "Git actions", "Changes".
- **Branch:** "Search refs...", `Create new ref "{name}"`, "Copy branch name", "Start from remote". RPCs: `vcs.listRefs`, `vcs.switchRef`, `vcs.createRef`.
- **Worktree per thread:**
  - The modes are "New worktree", "Current checkout", "Local checkout", "Current worktree", "Previous worktree ({branch})", "From {branch}" (`components/BranchToolbar.logic.ts:92-152`).
  - In the contract: `root | existing_worktree | worktree{baseRef, startFromOrigin}` (`orchestrationV2.ts:652-668`).
  - Deleting a thread removes the worktree only that thread used.
- **Git actions** (`components/GitActionsControl.logic.ts:139-325`):
  - The main button follows the repo's state: "Commit", "Commit & push", "Commit, push & create PR", "Push", "Push & create PR", "Create PR", "Pull", "Sync ref", "Publish repository", "Initialize Git".
  - Commit dialog: "Commit message (optional)" ("Leave empty to auto-generate"), "Commit on new branch", and files can be left out.
  - On the default branch it asks "Commit & push to default ref?".
  - A row "Changes +N −M" opens the Diff.
  - RPC: `git.runStackedAction` with `commit | push | create_pr | commit_push | commit_push_pr` (`packages/contracts/src/git.ts:18-25`).
- **No stash:** "stash" in T3 means putting a prompt aside.

## 8. Checkpoints

- After each turn the server snapshots the work tree into git: `write-tree` → `commit-tree` → `update-ref refs/t3/orchestration-v2/checkpoints/<scope>/ordinal/<n>` (`apps/server/src/orchestration-v2/CheckpointService.ts:148-158`).
- Turn diffs read these snapshots.
- "Edit from here?" offers "Revert files too" (`checkpoint.rollback {restoreFiles}`).
- Banda has ADR 0027's rewind without file revert. File revert would need such snapshots (ADR 0027:33).

## 9. Terminal

- A drawer per thread (mod+j), and also `terminal:*` tabs. It is drawn with a libghostty WASM build; the server side is `node-pty`.
- Splits: "Split Terminal Horizontally / Vertically".
- Menu: "Add to chat", "Copy", "Paste", "Jump to latest".
- Banda has a terminal module already. What it lacks is "Add to chat", a terminal tied to a Thread, and the Thread's worktree as its folder.

## 10. Opening things from the chat, or by the Agent

- **There is no URL scheme for panels.** Everything calls the panel store: `open`, `openFile(ref, path, line)`, `openPullRequest`, `openSideChat`, `openProactive`, `revealSurface`.
- **File paths in a reply** become chips (`components/MarkdownFileLink.tsx`; `ChatMarkdown.tsx:798`).
  - A click opens a `file` tab at the given line.
  - Cmd/Ctrl-click opens the file in the external editor.
  - The menu has "Preview media", "Open in integrated browser", and copy relative or full path.
- **A PR URL in a reply** opens a `pull-request` tab, unless a modifier key is held (`lib/openPullRequestLink.ts`; setting `pullRequestLinksOpenInApp`, default on).
  - Hovering shows a preview.
  - The right-click menu adds "Link to thread" / "Unlink from thread" (`externalLinkContextMenu.ts:27-45`).
- **Other link schemes:** `t3-thread://` (a link to a thread), `t3-citation://`, `t3-context://`.
- **Deep links:** `t3code://new?prompt=…&repo=…` or `?pr=owner/name#N`, and `t3code://threads/<env>/<thread>`.
- **What the Agent can open:**
  - `preview_open`: a browser tab in this thread.
  - `device_open`: the Device panel.
  - `html_render`: an attachment above the reply, not a panel.
  - The Agent has **no** tool to open the Diff, a file or a PR. Those open from links, by themselves after a turn, or when the Agent links a PR.

## 11. Git hosts

- **`packages/source-control-core`:**
  - A host is a definition (`shared/definition.ts:237`): plain data plus parsers for URLs, `checkoutCommand`, `changeRequestCreateCommand` and so on.
  - A driver (`server/driver.ts`) gives `sourceControl` (list, get, create, checkout) and `pullRequests` (`PullRequestProvider.ts:317-578`).
- **Hosts:** GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo, GitCafe.
- **GitHub** uses REST and GraphQL. Its token comes, in this order, from Settings, the "T3 Code for GitHub" app sign-in, `GH_TOKEN` / `GITHUB_TOKEN`, then `gh auth token`. The other hosts use their CLIs (`glab`, `fj`/`tea`, `az`) or tokens.

## 12. What Banda has today

- **Opening a Pane:**
  - A module declares its Pane kinds in code (`app/ui/src/pane.ts:95-141`). Panes open `right | below | here` (`pane.ts:72`).
  - The engine places Panes (`modules/workspaces/engine/src/model.rs:132-157`: `Column | Stack | Beside{pane, side}`).
- **Agents and Panes:**
  - An Agent can already open a Pane with `open_pane`, but only kinds on `AGENT_KINDS = ["agents.thread", "agents.diff", "browser.browser"]` (`modules/workspaces/engine/src/lib.rs:90`, ADR 0032 decision 3).
  - Without `beside`, the Pane goes into the default column. Nothing yet knows which Thread is the Agent's own (ADR 0029 decision 4 is not built).
- **Diff:** `agents.diff` (`modules/agents/pane/src/DiffPane.tsx`) shows one turn's changes, taken from the tool calls' diffs (`changes.ts`), and nothing from git. "Changed files" under a turn opens it.
- **Git:** only `git ls-files` for `@` file search (`modules/agents/engine/src/files.rs:62-75`). There are no branches, worktrees, `gh` calls or git status.
- **Links in messages:**
  - The desktop sends `http(s)` links to the system browser (`app/desktop/src/main.ts:438-446`) and drops other schemes.
  - File paths are not links.
  - Files open only from the Banda menu's Files source, in a browser Pane (`modules/browser/pane/src/index.ts:26-45`).
- **Fork:** a Thread can be forked from a reply (ADR 0027), so a side chat is a fork with a few flags more.
- **Settling:** the sidebar already groups Threads as Working and Settled, as T3 does, so "settle on merge" has a place to land.
- **Promises made in earlier ADRs:**
  - worktrees "later": ADR 0005:69, :192;
  - sidebar parts `branch`, `pr`, `diff`: ADR 0008:76;
  - "the git modules, each a Pane of its own, come with their ADR": ADR 0024:124-126;
  - file revert only in a worktree: ADR 0027:33.

## 13. How it maps onto Banda (proposal, for the ADR)

| T3 | Banda module | Pane kinds | Opened from |
| --- | --- | --- | --- |
| Diff panel | `git` (engine: status, refs, diff) | `git.diff` with scopes Uncommitted / Changes / Commit / Turn | "Changed files", a tool call, the Banda menu, `open_pane` |
| Thread details → git | `git` | `git.space`: branch, changes, Commit / Push / Create PR | the Banda menu, the sidebar row's menu |
| Files panel | `files` | `files.tree`, `files.file` (read first, edit later) | a path in a message, `@` chips, the Banda menu, `open_pane` |
| PR panel | `pulls` (engine: GitHub through `gh`) | `pulls.pull` (Summary / Timeline / Code) | a PR URL in a message, a badge, `open_pane` |
| Linked pull requests | `pulls` | `pulls.linked` (a Thread's links) | the Thread's badge, the sidebar; Agent tools `link_pull_request` and others |
| Side chat | `agents` | `agents.thread` with `side`, opened beside its Thread | `/side`, `/btw`, the Thread's menu |
| Worktree per Thread | `git` + `agents` | — (a choice in New Thread) | New Thread |
| Terminal drawer | `terminal` (exists) | `terminal.terminal` beside a Thread, in its folder | the Banda menu, `open_pane` |

Things that cut across all of them:

1. **One way to open.** A message link, the Banda menu, the CLI and an Agent all go through `workspaces.open`. The new kinds join `AGENT_KINDS`, and "beside its own Thread" is finally built.
2. **Links in replies.** A file path becomes a chip that opens `files.file` at its line. A PR URL opens `pulls.pull`. A modifier key opens them outside Banda.
3. **Comments go to the Agent.** A line comment in the Diff, a File or a PR's Code tab becomes a chip in the Thread's composer, as in T3.
4. **Opening by itself.** The Diff after a turn and the PR once linked; off by default, as in T3.

Open questions for the Person:

- one ADR with steps, or an ADR per module;
- GitHub only, through `gh`, at first;
- one Diff Pane that also shows turns, or keep `agents.diff` for turns;
- Files read-only at first;
- where Commit / Push / Create PR live: a `git.space` Pane, the Banda menu, or both;
- a worktree per Thread now or later;
- the PR Guide and PR review actions (approve, merge) now or later.
