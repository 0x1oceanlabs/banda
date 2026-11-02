---
status: accepted
date: 2026-11-02
---

# Development is modules in Panes beside the Thread, as in T3 Code

T3 Code puts development beside the chat: a Diff, the Files, a pull
request and the ones linked to a thread, a side chat, and a panel with
the branch and Commit / Push / Create PR. Banda has only one turn's
changes (`agents.diff`, ADR 0010, decision 3). Earlier ADRs promised the
rest: worktrees "later" (ADR 0005), the sidebar parts `branch`, `pr` and
`diff` (ADR 0008), "the git modules, each a Pane of its own, come with
their ADR" (ADR 0024, decision 5). On 2026-11-02 Roma asked for them,
first to be discussed. This is that ADR.

**What T3 Code does** is in
`docs/research/2026-11-02-t3-code-development.md` (its source at
`ac8dce0`, 2026-11-02). In short:

- One right panel with tabs: Diff, Files, a file, a PR, the linked PRs, a
  side chat, a terminal, a browser. A thread details panel holds the
  branch, the worktree, the git actions and the changes.
- The Diff compares what the Person picks: "Changes" (the branch against
  a base), "Uncommitted", a turn, a commit. A comment on lines goes to the
  Agent as a chip in the composer, not to a server.
- A PR has Summary, Code and Timeline tabs, and merge, auto-merge, ready
  and draft. A thread keeps the PRs linked to it; the Agent links and
  watches them with tools; a watch wakes the Agent; a thread whose PR
  merged settles.
- A side chat is a hidden fork of the thread, `/side` or `/btw`, and
  "Bring back" hands its end to the main thread.
- A path in a reply opens the file at its line; a PR URL opens the PR.

**What Banda has.** Panes are placed by the workspaces engine
(`workspaces.open`, ADR 0025); an Agent opens a Pane with `open_pane`,
only of the kinds on `AGENT_KINDS` (ADR 0032, decision 3). The engine
knows no git but `git ls-files` for `@` (`agents.files`); a Space does
not know whether its folder is a repository; nothing calls `gh`; nothing
watches files. A Thread forks (ADR 0027), and the sidebar has Working and
Settled (ADR 0008).

**Decision.** Roma decided the points marked _decided_ on 2026-11-02;
the rest are our defaults, as T3 Code does, and stay Roma's to change.

1. **One ADR, built in steps, module by module** (_decided_). Each part is
   a module of its own, with its engine part, its Panes and its
   `module.toml` (ADR 0022), and each Pane opens in the Strip beside the
   Thread, as Banda has no panels inside a Pane:

   | Module | Panes | What it holds |
   | --- | --- | --- |
   | `git` | `git.diff`, `git.space` | status, refs, diffs, commit, push |
   | `files` | `files.tree`, `files.file` | the Space's files |
   | `pulls` | `pulls.pull`, `pulls.linked` | pull requests, through `gh` |
   | `agents` | `agents.thread`, as a side chat | the fork it is |

   The first is `git` (_decided_): the Diff is what comments, a PR's Code
   tab and a worktree later stand on, and it is nearest to what Banda has.

2. **One Diff Pane, `git.diff`, with what it compares** (_decided_).
   - Its scopes, as T3 Code's: **Changes** (the branch and the work tree
     against a base, the default), **Uncommitted** (the work tree against
     `HEAD`), **Commit** (one of the branch's commits: "No commits on this
     branch.") and **Turn** (what a turn of a Thread changed).
   - The base, for Changes, is "Automatic" (where the branch left the
     default branch) or a ref picked from a list with search.
   - Its toolbar, as T3 Code's: refresh, expand or collapse all files,
     stacked or split, wrap lines, hide whitespace changes, show or hide
     the file tree.
   - **Turn is `agents.diff` today, and `agents.diff` goes.** A turn's
     changes still come from its tool calls, not git, so Turn works in a
     Space that is no repository. The agents engine answers
     `agents.changes { thread, turn }` with each file's text before and
     after, and the Diff draws them; the other scopes ask `git`. "Changed
     files" under a turn opens `git.diff` on Turn, beside the Thread. A
     Pane kept as `agents.diff` opens as `git.diff` on its turn.
   - The diff view itself (a file's lines, the line diff, the file list)
     moves from the agents Pane to `app/ui`, so `git.diff`, `files.file`
     and `pulls.pull` draw changes the same way.
   - In a folder that is no repository, the git scopes say so: "This
     Space's folder is not a git repository." Turn stays.

3. **The git engine runs `git`.** It runs the `git` program in the Space's
   folder, with a time limit, as T3 Code does, and no library of its own.
   - Reads: `git.status` (branch, upstream, ahead and behind, the changed
     files with `+N −M`), `git.diff { scope }`, `git.refs`, `git.commits`.
   - Commands: `git.commit { message, files, branch? }`, `git.push`,
     `git.pull`, `git.switch { ref }`, `git.branch { name, from? }`,
     `git.init`. Each says in a line what went wrong, as git said it.
   - The status follows the folder: a stream `git.watch` reads it again
     every few seconds while a Pane follows it, and says only what
     changed. A watcher on the folder can replace the polling later.

4. **`git.space`: the branch, the changes, and one main button.**
   - The branch, with search, "Create branch …" and "Copy branch name";
     ahead and behind; the changed files, each opening `git.diff` on that
     file.
   - The main button follows the state, as T3 Code's: Commit, Commit &
     push, Push, Pull, Create PR (with `pulls`, decision 6), Initialize
     Git.
   - Commit asks for a message, can leave files out, and can commit on a
     new branch. On the default branch it asks first: "Commit and push to
     the default branch?". A message the model writes for an empty field comes later.
   - The same actions are in the Banda menu (ADR 0017), under Git: Diff,
     Commit, Push, Switch branch. They act in the focused Space.

5. **`files`: the tree and a file, read-only at first.**
   - `files.tree`: the Space's files, with search, refresh, expand and
     collapse; a file's menu has "Copy path" and "Add to chat" (as an `@`
     chip in the focused Thread's composer).
   - `files.file`: a file with its lines numbered and coloured (Shiki, as
     the composer's code), opened at a line; markdown and images rendered.
     Editing, with saving as one types, comes later.
   - `agents.files`' listing moves to `files`, and `@` asks it there.

6. **`pulls`: GitHub through `gh` at first.**
   - The engine runs `gh`, signed in as the Person is; other hosts later.
   - `pulls.pull`: Summary (description, reviewers, labels, checks,
     comments), Code (its diff by commit, in the shared view), Timeline.
     Its actions: merge (merge, squash or rebase, asked once more), enable
     or disable auto-merge, ready for review, convert to draft, close,
     reopen. Review (approve, request changes) and the Agent-written Guide
     come later.
   - `pulls.linked`: the PRs linked to a Thread, with where each came from
     ("Linked by you", "Created from this Thread", "Linked by the Agent"),
     and Watch / Stop watching, Unlink.
   - A Thread's links: the Person pastes a URL or `#42`; Create PR in
     `git.space` links what it made; the Agent links with tools, as T3
     Code's: `link_pull_request`, `unlink_pull_request`,
     `list_thread_pull_requests`, `watch_pull_request`,
     `unwatch_pull_request`.
   - A watch reads a PR every two minutes and, when its checks fail or
     pass, a comment or review comes, or it conflicts, sends the Thread a
     message saying so, as T3 Code does. It ends on merge or close.
   - A Thread whose linked PRs all ended, the last merged, settles
     (ADR 0008), unless it is working or asks something.
   - A Thread's row in the sidebar shows its PR's number (`+N` for more):
     the sidebar part `pr` of ADR 0008. A module then needs a way to add
     a part to another module's rows; that comes with this step.

7. **Links in replies open Panes.** A path in a reply (`src/a.ts:12`)
   becomes a link that opens `files.file` at that line; a PR URL opens
   `pulls.pull`. With a modifier key they open outside Banda: the system
   browser, or the file in the Person's editor.

8. **One way to open, beside the Thread.** A link, the Banda menu, the
   CLI and an Agent all open through `workspaces.open`. A Pane a Thread
   opens goes in the column right of the Thread's Pane (ADR 0029,
   decision 4, built here for every kind). `git.diff`, `files.file` and
   `pulls.pull` join `AGENT_KINDS`: they show and run nothing. `git.space`
   and `pulls.linked` do not, as their buttons act as the Person.

9. **A comment on lines goes to the Agent.** In `git.diff`, `files.file`
   and a PR's Code tab, lines picked and "Add a comment…" put a chip in
   the Thread's composer (the path, the lines and the words), sent with
   the next message, as T3 Code's review comments are. Nothing is kept
   on a server.

10. **A side chat is a fork beside its Thread.** `/side [words]` or `/btw`
    forks the Thread at its latest reply (ADR 0027) into a Thread marked
    as its side chat: hidden from the sidebar's lists, opened beside it,
    in the same folder, asking before it changes files. Its first message
    carries a digest of the Thread. "Bring back" puts what it ended with
    into the Thread's next message.

11. **Not now.**
    - A worktree per Thread (_decided_: later): it changes a Thread's
      folder and what deleting a Thread removes, and gets its own ADR.
    - Reverting files with Edit from here; it needs checkpoints of the
      files, as T3 Code's are, in a worktree of the Thread's own.
    - Panes that open by themselves after a turn or once a PR is linked
      (off by default in T3 Code).
    - Editing files, hosts other than GitHub, a PR's review and Guide, a
      terminal tied to a Thread.

## Steps

Each a PR, tried in the window, with `/simplify` before it:

1. **The Diff.** The `git` module with `git.status`, `git.diff`,
   `git.refs` and `git.commits`; `git.diff` with its four scopes; the
   diff view in `app/ui`; `agents.changes`; "Changed files" opens
   `git.diff`; `agents.diff` goes.
2. **The branch and Commit.** `git.space`, the git commands, `git.watch`,
   the Banda menu's Git actions.
3. **Files.** `files.tree`, `files.file`, paths in replies as links,
   `agents.files` moved.
4. **A pull request.** `pulls` on `gh`, `pulls.pull`, Create PR from
   `git.space`, PR URLs in replies as links.
5. **A Thread's pull requests.** `pulls.linked`, the Agent's tools, the
   watch, settling on merge, the PR on the sidebar row.
6. **Comments to the Agent**, from the Diff, a file and a PR's Code tab.
7. **Side chat.**

## Consequences

- Banda gets three modules, and with them the first engine part that runs
  `git` and `gh` as the Person; their commands need the Write right, and
  an Agent reaches them only through the Panes and tools named here.
- `agents.diff` goes from the contract and from `AGENT_KINDS`; a Pane kept
  with it opens again as `git.diff`.
- The diff view leaves the agents Pane for `app/ui`.
- The sidebar learns parts from another module (decision 6), which ADR
  0008's `branch` and `diff` can use after.
