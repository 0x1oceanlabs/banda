# T3 Code: git actions, branch and thread-details UX

Source: `/tmp/t3src/t3code` at commit `c8a601c0`. Paths below are relative to `apps/web/src/components/` unless they start with `packages/` or `apps/`.
UI strings are quoted exactly. T3 uses three ASCII dots (`...`), not `…`. "PR" and "pull request" come from provider terminology: GitHub, Forgejo, Bitbucket, Azure and GitCafe say `PR` / `pull request` / `a PR`, and GitLab says `MR` (`packages/source-control-*/src/shared/definition.ts`). This doc writes the GitHub form.

---

## 0. The big picture

There is no separate "git panel". Git lives in four places:

1. **Thread details card** (`chat/ThreadDetailsPanel.tsx`). This is a floating 280px glass card at the top right of the chat. It is inline when the chat is wide enough and a popover from a header toggle otherwise. It holds the branch picker, the PR row(s), the git action split button and the Changes row. Nearly all git UX is here.
2. **Composer context strip** (`BranchToolbar.tsx`, `layout="composer"`), under the composer. It shows the workspace mode (Current checkout / New worktree), the branch picker and a PR badge. It always shows on a new (draft) thread. After the first send it shows only if the setting "Composer context" is on (default off).
3. **Sidebar thread row** (`sidebar/SidebarThreadRow.tsx`). A meta line shows the worktree icon, the branch, the PR badge and a `+N −M` slot. The `+N −M` slot is dead in this commit (see §5.2).
4. **Right panel**: the Diff surface (opened by the Changes row or by `mod+d`) and the Pull requests surface.

The command palette has no commit, push or branch commands (§5.4).

---

## 1. Thread details card (`chat/ThreadDetailsPanel.tsx`)

### 1.1 Sections and rows

Sections render in this order (`ThreadDetailsPanel.tsx:164-265`). **No section shows a visible heading**: `showHeading={false}` on both the Workspace and Version Control sections (`:166-171`, `:216-221`). The `title` exists only as an aria-label. Sections are told apart only by a hairline `border-t` divider (`ThreadDetailsSection.tsx:136-139`). An empty section collapses (`has-[>div:last-child:empty]:hidden`).

| Section (aria-label) | Rows | Item id → label in the "Choose what to show" menu |
|---|---|---|
| `Workspace` | Run context row (machine + workspace mode) | `environment` → "Environment and worktree" |
| | Open in editor picker | `openIn` → "Open in editor" |
| | Project scripts | `scripts` → "Project scripts" |
| `Version Control` | Branch picker row + PR row(s) | `branch` → "Branch and pull request" |
| | Git actions split button | `gitActions` → "Git actions" |
| | Changes `+N -M` row | `changes` → "Changes" |
| (own sections) | Servers, Automations, Lineage/Side chats, Usage limits, Context window | `servers`, `automations`, `lineage`, `sideChats`, `usage`, `context` |

The item list is in `chat/threadDetailsItems.ts:4-17`. Every item is visible by default except "Usage limits" and "Context window" (`defaultVisible: false`).

When each part shows (`ThreadDetailsPanel.tsx:152-161`):
- `branch`: needs `gitCwd !== null && isGitRepo && visible.branch`.
- `git`: needs `gitCwd !== null && activeProjectName !== undefined && (visible.gitActions || (visible.changes && isGitRepo))`.
- `environment` shows only at **full** density. `openIn` is hidden at **essential** density.

**Density** (`chat/threadDetailsCardLayout.ts:8-15`, `ThreadDetailsCard.tsx:55-58`). The card measures its own content: `full` if everything fits the height, else `compact`, else `essential`. In `compact` mode the git action button is **hidden** unless an action is running or a success is showing (`GitActionsControl.tsx:1501`). The Changes row stays.

**Quiet empty draft** (`GitActionsControl.tsx:1119-1126`). A fresh draft, or a thread with no turns yet, hides both the git action row and the Changes row while there is nothing to do (no progress, no error, quick action disabled, `+0 -0`).

**Not a repo**. The git action row becomes a single row `Initialize Git`, which reads `Initializing...` while running (`GitActionsControl.tsx:1487-1500`). Failure shows the toast `Git initialization failed`.

### 1.2 Where hiding is set

- **Right-click the card**. This opens a menu with the group label `Show in thread details`, one checkbox per item, a separator, then `Reset to default` (`chat/ThreadDetailsItemsMenu.tsx`, opened at `ThreadDetailsPanel.tsx:131-148`, `:287-305`). Right-clicks on inputs, links and selected text keep their native menu.
- **Settings → Appearance → "Thread details"**. Description: "Choose what the thread details card shows. You can also right-click the card." The control is a button reading `N of 12 on ▾` that opens the same menu (`settings/ThreadDetailsItemsRow.tsx`).
- Storage: the client setting `threadDetailsItems: Record<string, boolean>` (`packages/contracts/src/settings.ts:486`). It is sparse and stores only values that differ from the default (`threadDetailsItems.ts:46-54`).
- If every item is hidden, the card shows one row: `⚙ Choose what to show` (`ThreadDetailsPanel.tsx:267-284`).

### 1.3 Opening the card

- Header toggle (`chat/PanelLayoutControls.tsx:52-77`): a `SquareMenuIcon` toggle with aria-label "Toggle thread details panel". Its tooltip is `Toggle thread details (⌘⇧B)`.
- Shortcut `mod+shift+b` → `threadPanel.toggle`.
- Inline mode (an `aside` pinned at the top right) or popover mode (anchored under the header toggle). The choice depends on the chat width (`threadDetailsCardLayout.ts:17-47`, card width 280, gap 12).

### 1.4 Mockup, full density, feature branch with changes

```
╭──────────────────────────────── 280px ─╮
│ 🖥  This device                      📁 ▾│  ← Run context (Run on / Workspace menu)
│ </> Open in VS Code                    ▾│  ← Open in editor
│ ▶  dev                              ▾ + │  ← Project scripts
├────────────────────────────────────────┤  (hairline; no heading)
│ ⑂  feature/search-box                 ▾ │  ← Branch picker (select row)
│ ◯  #128: feat: add search box           │  ← PR row (only if PR exists)
│ ⬆  Commit, push & PR             │  ▾   │  ← Git actions split button
│ ▤  Changes                  +124  -18   │  ← opens Diff
├────────────────────────────────────────┤
│ ... Servers / Automations / Lineage ... │
╰────────────────────────────────────────╯
```
Rows are 32px tall (`h-8`), with `rounded-lg` and 13px medium text at `text-foreground/80`. They have no resting fill and get a `black/3.5%` (dark: `white/8%`) fill on hover (`chat/threadDetailsPanelStyles.ts`). On a split row the hairline between halves shows only on hover or while open (`:203-205`).

---

## 2. Git actions split button (`GitActionsControl.tsx` + `.logic.ts`)

The control is a split button. The left part is the **quick action** (one smart label). The right part is a `▾` chevron that opens a **menu** at the full width of the row (`GitActionsControl.tsx:1502-1626`).

### 2.1 The quick action state machine (`GitActionsControl.logic.ts:177-327`)

Inputs come from `VcsStatusResult`: `refName`, `hasWorkingTreeChanges`, `aheadCount`, `behindCount`, `aheadOfDefaultCount`, `hasUpstream`, `hasPrimaryRemote`, `isDefaultRef`, `pr.state`. Rules are checked in order. The first match wins.

| # | Condition | Label | Enabled? | Runs (`GitStackedAction`) | Hint / tooltip when disabled |
|---|---|---|---|---|---|
| 0 | not a repo (`isRepo=false`) | `Initialize Git` (row, not split) | yes | `vcs init` | – |
| 1 | action already running | `Commit` | no | – | "Git action in progress." |
| 2 | no status | `Commit` | no | – | "Git status is unavailable." |
| 3 | detached HEAD | `Commit` | no | – | "Create and checkout a ref before pushing or opening a pull request." |
| 4a | **changes** and (behind, or no upstream and no remote) | `Commit` | yes | `commit` | – |
| 4b | **changes** and (open PR, or on default branch) | `Commit & push` | yes | `commit_push` | – |
| 4c | **changes**, otherwise | `Commit, push & PR` | yes | `commit_push_pr` | – |
| 5a | clean, no upstream, **no remote** | `Publish repository` | yes | opens publish wizard | – |
| 5b | clean, no upstream, not ahead, open PR | `Commit` | no | – | "Branch is up to date. No action needed." |
| 5c | clean, no upstream, not ahead | `Push` | no | – | "No local commits to push." |
| 5d | clean, no upstream, ahead, open PR or default | `Push` | yes | `push` (default branch: `commit_push`) | – |
| 5e | clean, no upstream, ahead | `Push & create PR` | yes | `create_pr` | – |
| 6 | ahead **and** behind | `Sync ref` | **no** | – | "Branch has diverged from upstream. Rebase/merge first." |
| 7 | behind | `Pull` | yes | `pull` | – |
| 8a | ahead, open PR or default | `Push` | yes | `push` / `commit_push` | – |
| 8b | ahead | `Push & create PR` | yes | `create_pr` | – |
| 9 | open PR, has upstream, in sync | `Commit` | no | – | "Branch is up to date. No action needed." |
| 10 | ahead of default, not on default (pushed, no PR) | `Create PR` | yes | `create_pr` | – |
| 11 | otherwise | `Commit` | no | – | "Branch is up to date. No action needed." |

Notes:
- The exact label is **`Commit, push & PR`** (`` `Commit, push & ${shortLabel}` ``, `:222`), not "…& create PR". Without changes the labels are `Push & create PR` and `Create PR`.
- A connection without write scope makes every quick action disabled with "This connection cannot change source control." (`GitActionsControl.tsx:1113-1117`).
- When disabled, the button stays visible with `aria-disabled`. Hovering it opens a small tooltip-style popover with the hint (`:1532-1563`). Clicking does nothing. The `show_hint` info-toast path (`:1323-1330`) is effectively unreachable from the panel, because every `show_hint` result is `disabled: true`.
- Icons (`:292-313`): commit → `GitCommitIcon`; push/commit_push/publish → `CloudUploadIcon`; pull → `CloudDownloadIcon`; anything that makes a PR → the provider icon (GitHub mark). For disabled hints: `Commit` → commit icon, `Push` → upload icon, anything else (e.g. `Sync ref`) → `InfoIcon`.
- The quick action **never opens the commit dialog**. It commits right away, with an auto-generated message and all files.

### 2.2 The `▾` menu (`logic.ts:108-175`, rendered `GitActionsControl.tsx:1413-1481`)

Opening the menu triggers a status refresh (`:1597-1601`).

```
┌────────────────────────────────────────┐
│ ⊙  Commit                               │  → opens Commit dialog
│ ⬆  Push                                 │  → runs push now
│ ◯  Create PR                            │  → runs create_pr now
│ ⬆  Publish repository...                │  (only when no primary remote)
│ Detached HEAD: create and check out a   │  (warning text, if detached)
│ branch to enable push and pull request  │
│ actions.                                │
│ Behind upstream. Pull/rebase first.     │  (warning, clean + behind + not ahead)
│ <git status error text>                 │  (destructive text)
└────────────────────────────────────────┘
```
- No remote → the menu has only `Commit` (plus `Publish repository...`). Open PR → `Commit` and `Push` only (no `Create PR`).
- Enablement: `Commit` needs changes. `Push` needs a branch, not behind, ahead > 0, and an upstream or remote. `Create PR` needs a branch, no open PR, ahead of default > 0, not behind, and an upstream or remote.
- Disabled items show a reason in a hover popover on the left (`:214-274`):
  - Commit: "Worktree is clean. Make changes before committing."
  - Push: "Detached HEAD: check out a branch before pushing." / "Commit or stash local changes before pushing." / "Branch is behind upstream. Pull/rebase before pushing." / 'Add an "origin" remote before pushing.' / "No local commits to push."
  - Create PR: "Detached HEAD: check out a branch before creating a pull request." / 'Add an "origin" remote before creating a pull request.' / "No local commits to include in a pull request." / "Branch is behind upstream. Pull/rebase before creating a pull request."
  - Busy: "Git action in progress."
- `Push` and `Create PR` in the menu run right away (`:1337-1346`). Only `Commit` opens a dialog. **There is no "View PR" item on web.** The PR is opened from the PR row (§3.4). `packages/client-runtime/src/state/gitActions.ts` has `View PR` variants used by the mobile app.

### 2.3 Commit dialog (`GitActionsControl.tsx:1659-1833`)

```
╭─ Commit changes ─────────────────────────────────────────╮
│ Review and confirm your commit. Leave the message blank   │
│ to auto-generate one.                                     │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Branch   feature/search-box          [Default branch] │ │ ← warning text if on default
│ │ Files (3 of 5)                                 [Edit] │ │
│ │ ┌───────────────────────────────────────────────────┐ │ │
│ │ │ ☑ …/components/SearchBox.tsx        +80 / -2      │ │ │ ← h-44 scroll list, mono
│ │ │ ☐ …/lib/old.ts                      Excluded      │ │ │   checkboxes only in Edit mode
│ │ │ ☑ README.md                         +4 / -0       │ │ │   click path → open in editor
│ │ └───────────────────────────────────────────────────┘ │ │
│ │                                         +84 / -2      │ │ ← total of selected files
│ └───────────────────────────────────────────────────────┘ │
│ Commit message (optional)                                 │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Leave empty to auto-generate                          │ │
│ └───────────────────────────────────────────────────────┘ │
│              [Cancel] [Commit on new branch] [■ Commit]   │
╰───────────────────────────────────────────────────────────╯
```
- Title "Commit changes". Description "Review and confirm your commit. Leave the message blank to auto-generate one." (`:276-278`).
- Branch row: the ref name, or `(detached HEAD)`. When on the default branch it adds `Default branch` on the right in warning color.
- Files: the list starts read-only. `Edit` toggles to `Done` and shows checkboxes (per file, plus a header checkbox with an indeterminate state). While not editing and some files are excluded, the header reads `Files (N of M)`. Excluded rows show `Excluded` instead of counts. With no files, the list reads `none`. Paths are start-truncated (`StartTruncatedPath`). Clicking a path opens the file in the preferred editor; failure shows the toast `Unable to open file`.
- Message: an optional textarea. If empty, the server generates the message (progress shows `Generating commit message...`).
- Buttons: `Cancel` (outline), `Commit on new branch` (outline, runs `commit` with `featureBranch: true`), `Commit` (primary, runs `commit`). Both commit buttons are disabled when no file is selected. The dialog **only commits**. It never pushes. File selection is sent as `filePaths` only when not all files are selected.
- **Commit on new branch** (server `apps/server/src/git/GitManager.ts:3002-3035`, `:3125-3143`). Phase `Preparing feature branch...`. The server generates a commit subject + branch name in one call, sanitizes it, dedupes against local branches, then creates and switches the branch and commits. It skips the default-branch confirmation. The thread's branch metadata is then updated to the new branch (`syncThreadBranchAfterGitAction`, `:1025-1032`).

### 2.4 Default-branch confirmation (`GitActionsControl.tsx:1846-1890`, copy `logic.ts:329-366`)

This shows when the action is `push`, `create_pr`, `commit_push` or `commit_push_pr` **and** the current ref is the default branch (`requiresDefaultBranchConfirmation`, `packages/client-runtime/src/state/gitActions.ts:316-327`). A plain `commit` never asks.

```
╭─ Commit & push to default ref? ──────────────────────────────────────────╮
│ This action will commit and push changes on "main". You can continue on  │
│ this ref or create a feature ref and run the same action there.           │
│ (muted, when tree is clean:) There are no changes to commit, so a feature │
│ branch can't be named. Create a branch yourself or continue on main.      │
│ [Abort]                  [Commit & push to main] [■ Check out feature     │
│                                                    branch & continue]    │
╰───────────────────────────────────────────────────────────────────────────╯
```
Copy variants:
- push / commit_push + commit: title "Commit & push to default ref?", body "This action will commit and push changes on "main". …", button `Commit & push to main`.
- push, no commit: "Push to default ref?", "This action will push local commits on "main". …", `Push to main`.
- create PR + commit: "Commit, push & create PR from default ref?", "This action will commit, push, and create a pull request on "main". …", `Commit, push & create PR`.
- create PR, no commit: "Push & create PR from default ref?", "This action will push local commits and create a pull request on "main". …", `Push & create PR`.
- Fallback title: "Run action on default branch?". Fallback button: `Continue`.
- `Check out feature branch & continue` reruns the action with `featureBranch: true`. It is disabled when the tree is clean, because the server names the branch from the uncommitted diff (`logic.ts:368-375`).

### 2.5 Progress display (inline, in the button, no toasts)

While running, the split button turns into a status row. The group gets a faint fill. The chevron is replaced by a live elapsed timer (`GitActionsControl.tsx:1512-1527`, `:1588-1592`; logic `:61-106`).

```
│ ◌  Running pre-commit...                       12s │
│    eslint --fix src/components/SearchBox.tsx       │  ← last hook output line, 2xs muted,
                                                         truncated, full text in tooltip
```
- Status label sequence (server phases, `GitManager.ts`): `Preparing feature branch...` → `Generating commit message...` (only when the message is empty) → `Committing...` → `Running <hookName>...` (each git hook, with live output line) → `Pushing...` → `Preparing PR...` → `Generating PR content...` → `Creating pull request...`. The client fallback is `Starting source control action...`. Pull shows `Pulling latest changes...` with no output line.
- Timer format: `Ns` under a minute, then `Mm Ss`. It counts from the hook start, else the phase start.
- `aria-live="polite"` status. The menu trigger is disabled while running.

### 2.6 Success and error

- **Success is inline**, in place of the button, for 10 s (`GIT_ACTION_SUCCESS_VISIBLE_MS`, `logic.ts:50`). It shows a green `✓`, a title, and an optional muted description line (`GitActionsControl.tsx:385-421`, `:1236-1244`). Titles come from the server's `summarizeGitActionResult` (`GitManager.ts:457-488`):
  - `Committed abc1234` (or `Committed changes`), with the commit subject as description
  - `Pushed abc1234 to origin/feature/x`, with the commit subject as description
  - `Opened PR #128` (an existing PR was found), with the PR title as description
  - PR created → the web overrides this to just `Created PR` with **no description**
  - `Done` (nothing happened)
  - Pull: `Pulled`, with "Updated main from origin/main". Or `Already up to date`, with "main is already synchronized." (`:1308-1319`)
- **Errors are toasts** that stay until dismissed (`timeout: 0`) and are scoped to the thread (`stackedThreadToast`): `Action failed`, `Pull failed`, `Git initialization failed`, `Unable to open file`, `Editor opening is unavailable.`. The description is the error message or "An error occurred.".
- The server also returns a `cta` (Push / View PR / Create PR) for the result toast (`GitManager.ts:1946-1981`). **The web ignores it.** Only mobile uses it.

### 2.7 What happens after

- `onSuccess: status.refresh` on every action (`state/sourceControlActions.ts:216, 253, 306`). The status drives the button, the Changes counts and the PR row, so everything re-derives. The menu also refreshes status on open.
- If a branch was created, the thread/draft `branch` metadata is patched (`GitActionsControl.tsx:984-1032`). A live effect also keeps a draft's branch in sync with the checkout (`:1077-1098`).
- The PR is not opened automatically. It appears as the PR row under the branch, via `status.pr` / `thread.branchPullRequest`. The server's PR body generation reads the thread's recent turns (`readThreadContext`, `GitManager.ts:2297`), the repo's PR template, and the writing-style policy.
- The setting "Open pull requests and changes panels proactively" (off by default) can open the PR or Changes right-panel surface when the agent finishes (§6).

### 2.8 Publish repository wizard (`GitActionsControl.tsx:423-925`)

This is reached from the quick action `Publish repository` or the menu item `Publish repository...`. It is a 3-step wizard: `Provider` → `Repository` → `Summary`.

```
╭ Publish repository ─────────────────────────────────────╮
│ Pick where to host it, then point us at a repo to push to.│
│  (1) Provider · GitHub   (2) Repository   (3) Summary    │
│ Provider                                                 │
│ ┌─────────────────┐ ┌──────────────────────────────────┐ │
│ │ ⬤ GitHub        │ │ ◯ GitLab        [Setup Required] │ │ ← not-ready cards greyed;
│ └─────────────────┘ └──────────────────────────────────┘ │   button → Settings › Source control
│                                     [Cancel]  [■ Next]   │
╰──────────────────────────────────────────────────────────╯
step 2:  Repository  [ github.com/ | roma/banda          ]   (prefilled "<account>/")
         Visibility  (🔒 Private · Only invited people) (🌐 Public · Anyone on the web)
         ▸ Advanced → Remote [origin]  Protocol [SSH|HTTPS]
         "Publishing repository to GitHub..." / "Publish failed" + message
                                           [Back]  [■ Publish]  ("Publishing..." while busy)
step 3:  ✓ Repository published — "<branch> is now live on GitHub."
           (or "Repository created" — 'Remote "origin" is set up. Make a commit and push it to share your code.')
         [ owner/repo ]   [Open on GitHub]                [■ Done]
```

---

## 3. Branch row and branch picker

### 3.1 Components

- `BranchToolbar.tsx` is the wrapper. `layout="panel"` is used in the details card, with `panelSection` = `"workspace"` (the run context row) or `"branch"` (the branch picker + PR rows) (`:691-737`). `layout="composer"` is the strip under the composer (`:739-832`).
- `BranchToolbarBranchSelector.tsx` holds the behaviour. `BranchPicker.tsx` is the combobox UI. `BranchToolbar.logic.ts` holds the pure rules.

### 3.2 Trigger label (`BranchToolbar.logic.ts:199-223`)

- No branch known → `Select ref`.
- New-worktree mode before the worktree exists (picking a **base**) → `From main`, or `From main (remote)` when "Start from remote" is on and the base is a local branch.
- Otherwise → the branch name, middle-truncated.
- The trigger is disabled while the first page of refs loads or while a switch is pending.
- The panel row has a `GitBranchIcon` and a select-style chevron cell on the right.

### 3.3 Picker popover (`BranchPicker.tsx`)

```
┌──────────────────────────────────────────┐
│ 🔍 Search refs...                        │
├──────────────────────────────────────────┤
│  ◯ Checkout pull request                 │  ← only when query parses as a PR ref
│    #128                                  │    (#123 / URL); opens the PR checkout dialog
│  feature/search-box              current │
│  main                            default │
│  fix/login                      worktree │  ← checked out in another worktree
│  origin/release-2                 remote │
│  chore/deps                              │
│  Create new ref "my-new-branch"          │  ← query non-empty, no exact match
├──────────────────────────────────────────┤
│ ↻ Start from remote                 (●○) │  ← only when choosing a new-worktree base
│ Showing 50 of 213 refs                   │  ← status line
└──────────────────────────────────────────┘
```
- Placeholder `Search refs...`. Empty state `No refs found.`. Status lines `Loading refs...`, `Loading more refs...`, `Showing N of M refs`. The list is virtualized (LegendList, 28px rows, max-h 56), loads the next page on scroll, and fades at top and bottom.
- Search is a server-side substring query plus a client filter. The query is also matched in sanitized form (spaces become dashes etc., `logic.ts:277-308`). Enter selects the highlighted row.
- **Local and remote are one list**, not tabs. Server order: current first, then default, then the rest (`apps/server/src/vcs/GitVcsDriverCore.ts:4084-4092`). A remote branch that has a local branch of the same name is deduped away. Each row has one faint right badge: `current` > `worktree` > `remote` > `default` (`BranchPicker.tsx:259-270`).
- The panel popup is as wide as the row and opens downward. The composer popup is `w-80` and opens upward.
- **`Create new ref "<name>"`** sanitizes the name, then runs `createRef` with `switchRef: true` in the current cwd (`BranchToolbarBranchSelector.tsx:441-476`). It is hidden while choosing a worktree base. Failure toast: `Failed to create and switch ref.`.
- **`Start from remote`** is a switch with the tooltip: "Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing." Its aria-label is "Start worktree from remote". The default comes from the setting `newWorktreesStartFromOrigin` (true).
- **`Copy branch name`**: right-click the trigger or any row to get a native context menu with one item, `Copy branch name`. It shows the toast `Branch name copied`, with the name as description. Failure: `Failed to copy branch name` (`:323-357`).
- If the connection has no write scope, picking anything gives the toast `Action unavailable` – "This connection cannot change the thread's branch.".

### 3.4 What selecting a branch does (`BranchToolbarBranchSelector.tsx:380-439`, `logic.ts:248-275`)

1. **Choosing a worktree base** (new-worktree mode, no worktree yet): only records the branch on the draft. No git command runs.
2. **The branch is checked out in another worktree**: the thread **moves to that worktree** (`reuseExistingWorktree`). No checkout runs.
3. **Default branch while in a worktree**: the thread goes back to the main checkout (`nextWorktreePath = null`).
4. Otherwise it runs `switchRef` in the target cwd. A remote ref becomes `git checkout --track` with a derived local name. The label updates optimistically and reverts on failure.
- **Uncommitted changes**: there is no stash prompt and no warning. The server runs plain `git checkout <ref> --` (`GitVcsDriverCore.ts:4765-4845`). Git carries non-conflicting edits along, or refuses. A refusal shows the toast `Failed to switch ref.` with git's own message.
- If the thread's agent session is running and the worktree changes, the session is **stopped** first (`:181-186`).
- After the switch, refs and status refresh, the composer refocuses, and the thread's `branch` / `worktreePath` metadata is updated.
- For a new worktree thread, once branches load, the base defaults automatically to the default branch, else the current one (`:478-503`).

### 3.5 PR row(s) under the branch (`chat/ThreadDetailsPrRows.tsx`, `chat/ThreadDetailsPrRow.tsx`)

These show only in the panel and only when a PR number and URL exist (`BranchToolbarBranchSelector.tsx:730-747`).

```
simple:   │ ◯  #128: feat: add search box                │
watched:  │ ◯  #128: feat: add search box           │ 👁 │   (eye → eye-off on hover = stop watching)
rich:     │ ◯  feat: add search box, wraps to two       │
          │    lines max                                 │
          │    #128  ✓ 5/5  👁               [Merge]     │   ← trailing action: Resolve ↗ / Ready / Fix ↗ / Merge
          │ ⌄  Show 2 more                               │   ← stacked / extra linked PRs
```
- The icon and color follow state: open, draft, merged or closed.
- Hover tooltip card: title + `#n`, state, `base ← head`, a checks summary, "Merge conflicts with main" (draft), `N files +a -d`, and a per-file breakdown.
- Trailing actions:
  - `Resolve` ("Check the branch out and resolve the conflicts in a new thread")
  - `Ready` ("Mark this pull request as ready for review")
  - `Fix` ("Fix the failing checks in a new thread")
  - `Merge` ("Merge this pull request (squash)"). This opens an alert: "Merge pull request?" / "This merges #128 using squash." / `Cancel` `Merge`.
- Pending labels: `Preparing...`, `Marking...`, `Merging...`.
- Watch tooltip: "Watching: the agent wakes when checks finish, someone comments, or the branch conflicts. Click to stop."
- Clicking the row opens the PR. Depending on the setting "Open pull requests in T3 Code" (default on), it opens in the in-app PR panel or in the browser.

### 3.6 Worktree modes (summary only; out of scope now)

- The run context row / composer strip offers a `Workspace` radio group: `Current checkout` (or `Current worktree` when already in one), `New worktree`, and `Previous worktree` with the branch on a second line (the latest non-archived thread worktree in this project). A `Run on` machine group sits above it with `Auto balance` and `Add to another machine ›` (`BranchToolbar.tsx:394-428`, `logic.ts:91-153`).
- Locked labels once a thread has started: `Worktree`, `New worktree`, `Local checkout`. Right-click on the path → `Copy full path` → toast `Path copied`.
- Related settings: Worktree branch naming (static / semantic / custom, prefix `t3`), Submodules, Start from remote, cleanup rules.

---

## 4. Changes row

`GitActionsControl.tsx:1629-1657`, totals from `logic.ts:436-452`.

```
│ ▤  Changes                          +124  -18 │
```
- `FileDiffIcon` + `Changes` on the left. On the right, mono tabular counts: `+N` in the diff-addition color and `-M` in the diff-deletion color. A zero count shows in the muted color. The panel uses an ASCII `-`; the sidebar uses `−`. `formatDiffCount` shortens large numbers.
- Totals: **branch changes vs base** if non-zero, else **working-tree changes** if non-zero, else branch (zeros), else tree (zeros).
- Click → `openChangesFromThreadPanel` → `addDiffSurface` (`chat/useRightPanelActions.ts:134-143`). This sets the Diff panel git scope to `"branch"` (the other scope is `"unstaged"`, `diffPanelStore.ts:30`) and opens the right-panel `diff` surface.
- The row is enabled only for server threads in a git repo (`ChatView.tsx:3897-3899`). A draft shows it disabled.
- It is hidden by the "Changes" item toggle, or by quiet-empty-draft.

---

## 5. Where else git shows

### 5.1 Header

- There are no git badges in `chat/ChatHeader.tsx`. Git lives behind the `Toggle thread details` button (`SquareMenuIcon`) and the right-panel toggle (`chat/PanelLayoutControls.tsx`).
- The Diff surface is in the right panel (`mod+d`, server threads only, `useRightPanelActions.ts:101-111`).

### 5.2 Sidebar row (`sidebar/SidebarThreadRow.tsx:1132-1179`)

```
│ Add search box to header                         ● │
│ 📂 feature/search-box     ◯ #128   +124 −18  🖥 ◐  │  ← meta line (card / folder-multiline)
```
- The meta line shows: worktree icon (only if the thread has a worktree; tooltip `Worktree: ~/…/path (branch)`), middle-truncated branch, terminal status, PR badge (number + state color; click opens the PR or the PR list), a `+N −M` slot, then the remote machine icon and the provider stack.
- **The `+N −M` slot is dead in this commit.** `latestRunDiff()` returns `null` (`:1593-1598`). The layout is kept, but no counts show.
- The meta line is dropped when it would be empty. It shows in the `card` and `folder-multiline` variants. Multiline rows in the boring sidebar are set by the client setting `boringSidebarMultilineRows`.
- The hover card shows project, machine, `⑂ branch`, and in warning color "You're currently checked out on another branch." when a local-checkout thread's branch differs from the real checkout (`:294-307`, `BranchToolbar.logic.ts:232-246`). It also lists PRs.

### 5.3 Composer context strip (`BranchToolbar.tsx:739-832`)

```
 📁 Current checkout ▾ │ ◯ #128  ⑂ feature/search-box ▾          [permissions]
```
- It shows on a draft thread always. On started threads it shows only with the setting **"Composer context"** — "Keep branch and worktree controls below the composer after a thread starts." (`persistComposerContextStrip`, default false; `BranchToolbar.logic.ts:63-76`).
- Labels collapse to icons when the strip is narrow, with hysteresis.

### 5.4 Keyboard shortcuts (`packages/shared/src/keybindings.ts:157-218`)

| Key | Command | Settings label (derived) | Effect |
|---|---|---|---|
| `mod+shift+g` | `composer.branch` | "Composer: Branch" | opens the branch picker in the composer strip (`chat/composerShortcuts.ts:31-33`) |
| `mod+shift+x` | `composer.workspace` | "Composer: Workspace" | opens the workspace-mode menu |
| `mod+shift+l` | `composer.previousWorktree` | "Composer: Previous Worktree" | switches the draft to the previous worktree |
| `mod+shift+h` | `composer.host` | "Composer: Host" | Run on machine |
| `mod+d` | `diff.toggle` | "Diff: Toggle" | toggles the Diff surface |
| `mod+shift+b` | `threadPanel.toggle` | "Thread Panel: Toggle" | thread details card |
| `mod+alt+b` | `rightPanel.toggle` | – | right panel |
| `mod+shift+k` | `pullRequest.copyNumber` | – | copy PR number (PR panel) |
| `mod+shift+c` | `thread.copyReference` | "Pull Request: Copy Link or Thread" | copies the PR link if any, else the thread |
| `mod+shift+n` | `chat.newLocal` | – | new thread in the local checkout |

All of these use `when: "!terminalFocus"` except `rightPanel.toggle`. **There is no shortcut for commit, push or the git action button.** Labels come from `commandLabel()` (`settings/KeybindingsSettings.logic.ts:370-390`).

### 5.5 Command palette (`CommandPalette.tsx`)

- There are no commit, push, pull or branch commands.
- Git-adjacent actions:
  - `Copy PR link` / `Copy thread` (shortcut `thread.copyReference`)
  - `Link pull request to thread`
  - `Show linked pull requests` (disabled when the thread has none)
  - `Open pull requests` (navigates to `/pull-requests`)
  - project creation: `New project` – "Start a new Git repository from a name", and clone "Git URL"
- Thread results show `#<branch>` in their description (`CommandPalette.logic.ts:449-451`). Palette search can match on Branch (`packages/shared/src/paletteSearch.ts:932`).

---

## 6. Settings related to git (`packages/contracts/src/settings.ts`)

### 6.1 Server settings. Most are project-overridable (`PROJECT_SCOPED_SERVER_SETTING_KEYS`, `:1024-1051`)

| Key | Default | UI title (page) | Description (exact) |
|---|---|---|---|
| `textGenerationModelSelection` | Codex, `gpt-6-luna`, reasoning `low` (`model.ts:135-138`) | "Text generation model" (Threads) | "Used for thread titles and other generated text on connected devices with this provider. Source control can override it." |
| `sourceControlWriterModelSelection` | `null` (= use the text generation model) | "Source control writer model" (Source control) | "Model for source control text and branch or bookmark names. When disabled, use the text generation model configured for this environment." This is the **commit message / PR / branch-name model**. |
| `sourceControlWritingStyle.mode` | `repo_conventions` | "Source control writing style" | Repository conventions – "In each project, matches recent change descriptions and change request titles." / Conventional Commits – "Use Conventional Commit prefixes and keep change request text concise." / Custom instructions (textarea, placeholder "Keep titles concise. Use short bullet points in descriptions.") |
| `sourceControlWritingStyle.followChangeRequestTemplates` | `true` | "Follow change request templates" | "Use the repository's template for change request descriptions when available." |
| `branchNamingMode` | `static` | "Worktree branch naming" (Worktrees) | "Choose how new worktree branches are named from your first message." Options `Static prefix` / `Semantic prefix` / `Custom instructions` |
| `branchNamePrefix` | `"t3"` | "Branch prefix" | "For example, t3 or t3/ produces t3/add-search. Leave empty for no prefix." |
| `branchNameInstructions` | `""` | "Branch naming instructions" | "Appended to the naming prompt. The model returns the complete branch name; no prefix or suffix is added." |
| `defaultAutoPull` | `false` | "Automatically pull" | "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it." |
| `automaticGitFetchInterval` | 30 s | "Git fetch interval" (Maintenance › Background activity) | background `git fetch` |
| `newWorktreesStartFromOrigin` | `true` | "Start from remote" (Worktrees) | same text as the picker tooltip (§3.3) |
| `defaultThreadEnvMode` | null → t3.json → `local` | "Workspace" | "Where new threads start. Projects and their t3.json can override it." |
| `worktreeSubmodules` | null → `recursive` | "Submodules" | "How new worktrees populate git submodules. …" |
| `pullRequestMergeMethod` | `null` (= last selected) | "Default merge method" (Source control) | "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device." |
| `removeAgentCreditsOnMerge` | `false` | "Remove agent credits when merging" | "Remove recognized agent credit lines from merge and squash messages on hosts that support it, keeping human co-authors. Includes auto-merge. Excludes merge queues, stack merges, and existing commits." |
| `sidebarAutoSettleOnMerge` | `true` | "Auto-settle merged threads" (Threads) | – |
| `reviewGuidesEnabled` (+ model, instructions) | `false` | "Review guides (beta)" | "Add a Guide tab to pull requests. An agent explains the changes and points out decisions that need review." |
| `worktreeCleanup`, `worktreesDirectory` | null / "" | Worktrees / Maintenance | cleanup rules (keep when uncommitted changes, etc.) |

**There is no auto-push setting and no "always commit on new branch" setting.** Push and PR behaviour is fully implied by the quick-action state machine.

### 6.2 Client settings

| Key | Default | UI title | Description |
|---|---|---|---|
| `threadDetailsItems` | `{}` (sparse overrides) | "Thread details" (Appearance) | see §1.2 |
| `proactivePanelsEnabled` | `false` | "Open pull requests and changes panels proactively" (Diffs › Pull requests) | "Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files or 50 lines." (`settings/SettingsPanels.tsx:1400-1424`, `ChatView.tsx:1993-2005`) |
| `persistComposerContextStrip` | `false` | "Composer context" (Appearance) | "Keep branch and worktree controls below the composer after a thread starts." |
| `pullRequestLinksOpenInApp` | `true` | "Open pull requests in T3 Code" (Diffs) | – |
| `diffLayout` / `diffFilesCollapsed` / `diffIgnoreWhitespace` / `diffColorScheme` | `stacked` / `true` / `true` / red-green | "Diff layout", "Default diff file state", "Diff colors" | – |
| `pullRequestMergeMethodOverrides` | `{}` | – | the per-device "last selected" merge method |

---

## 7. Notes for rebuilding in Banda (observations, not decisions)

- The core is one **pure function** `resolveQuickAction(status) → {label, kind, action, disabled, hint}` plus `buildMenuItems(status)` and `getMenuActionDisabledReason`. Both are easy to port unchanged and to unit test (T3 has `GitActionsControl.logic.test.ts`).
- One smart button that does the whole chain (commit → push → PR) with an AI message and no dialog. The dialog only exists behind `▾ → Commit`, for picking files or writing a message.
- Feedback stays inside the row: phase label, hook output line, timer, then an inline ✓ for 10 s. Only errors use toasts, and they stay until dismissed.
- A safety net only on the default branch, offering "check out feature branch & continue" with an AI-named branch.
- The branch picker is one searchable list (local + remote + "create" + "checkout PR"), with no stash handling. Git's own refusal is surfaced as a toast.
- The whole git area is quiet: no headings, no fills at rest, hidden on empty drafts, hidden under compact density, and every row can be toggled from a right-click menu.
