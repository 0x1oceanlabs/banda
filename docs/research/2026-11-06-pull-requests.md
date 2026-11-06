# Pull requests in T3 Code, Codex and Claude Code

How three agent apps tie a Thread to its pull requests, what they show of a
PR's state and where, and how they react when its checks or reviews change.
It is read to give Banda a model of pull requests before the bar's widget for
them (Roma, 2026-11-06: "agents work on several PRs in a Project at once …
I'd put the focus on the PRs and their statuses").

- **Sources:**
  - T3 Code's source at `337c5858` (2026-11-05), read only.
  - Codex: the docs at learn.chatgpt.com/docs (formerly
    developers.openai.com/codex), the changelog, and openai/codex issues. The
    desktop app is closed, so what it draws comes from its users' reports.
  - Claude Code: code.claude.com docs and the changelog, plus
    anthropics/claude-code issues for the desktop app, which the docs do not
    draw.
- **Notes:** the three full notes, with file and line references and every
  URL, are in Roma's brand workspace, `artifacts/git-branch/research-*.md`.
- **Mockups:** `artifacts/git-branch/v1.html`, the first widget, centred on a
  branch.

## 1. The link between a Thread and a PR

| | T3 Code | Codex | Claude Code |
| --- | --- | --- | --- |
| Held on | the Thread: a list of links | the thread, since Sep–Oct 2026; before, a search by branch | the session |
| A link is | host, repo, number, URL; who made it (`manual`, `created`, `agent`, `stack`); when | `[host, owner, repo, number]`; many per thread; looked up both ways; copied on a fork | the PR number and URL |
| Made by | a paste of a URL or `#42`; Create PR; the Agent's `gh pr create`, read from its shell; the Agent's tools | Create PR; `gh pr create`; the cloud keeps the turn that made it and the last commit pushed | Create PR; `gh pr create` and later `gh` and pushes on its branch; tools to link and unlink |
| From a PR back to its Thread | the PR page lists "Linked threads" | the reverse lookup | `claude --from-pr`, `#1234` in the agent list |

- **Guessing the PR from the branch is the bug all three had.**
  - Codex searched GitHub by branch: an old merged PR showed on every thread
    on `main`, and another worktree's CI showed in a thread.
  - Claude Code bound PRs by branch name: stale closed PRs showed in unrelated
    sessions, and two agents pushed to one branch.
  - T3 keeps a PR found by branch only as a fallback for its badge.
- **A PR the Person unlinked is never linked again** (T3 keys the link to the
  command that made it).

## 2. What is read, and how often

- **The state:**
  - open, closed or merged, and draft;
  - the checks, summed up as passing, failing or pending, or none;
  - the review: approved, changes requested, or review required;
  - mergeable, conflicting or unknown;
  - title, branches, `+a −d`, when read.
- **How T3 sums up the checks:**
  - any failure or cancel → failing;
  - else any pending or action required → pending;
  - else any success → passing.

  It dedups re-runs by workflow and name, the newest winning.
- **T3 reads them from the GitHub API** (batched GraphQL), with the token of
  `gh auth token`, at most 4 `gh` at once.
- **One reader per Project, not per row:**
  - Every minute, each PR is read once, however many Threads link it.
  - Open PRs untouched for 30 minutes are read every 5 minutes.
  - Merged and closed PRs are read every 15 minutes, then never.
  - It stops on a rate limit until GitHub says to retry.
  - It reads again at once after a push or the Agent's `gh pr merge`.
- **Polling per row is what went wrong elsewhere.**
  - Codex restoring threads spent ~194 of the user's GitHub calls in two
    minutes.
  - Claude Code polling ~1,200 merged PRs used up GitHub's 5,000 an hour.
- **GitHub sends no event when a branch falls behind or conflicts.** So the
  reader works out mergeable and behind itself (Claude Code's auto-fix cannot
  see them).

## 3. Where the state shows

| | T3 Code | Codex | Claude Code |
| --- | --- | --- | --- |
| Thread list | icon and `#N`, coloured by open / draft / merged / closed only; `+N` for several | the same four badges | CLI list: `#1234` yellow (waiting or failing), green (passing), purple (merged), grey (draft or closed); `3 PRs`, coloured by the most urgent |
| Thread | details card: the current PR, a checks pill ("3/5 checks", "2 failed", ✓), one action | right panel: branch, files, PR, failing checks, conflicts, comments | desktop: a PR bar over the prompt, with a CI popover and toggles Auto-fix, Auto-merge when ready, Auto-archive |
| Across Threads | a page of every PR on GitHub, sorted "Merge readiness" or "Blocked on me", which does not say which Thread owns a PR | none; an Activity view of chats that are unread, running or waiting | Projects: Threads grouped Ready for review / Waiting on you / Working / Landing / Idle / Resolved; a dot when something waits on you |
| A bar | none | none | the CLI's footer: `PR #446`, underlined in its review's colour |

- **None of them shows which PR needs the Person across their Agents.**
  - T3's sidebar colours only open or merged: a failing check or a conflict
    is not seen until the Thread opens.
  - Codex counts only a chat that waits for an answer: a red CI never raises
    it, and users ask for it (#59619).
  - Claude Code's Projects comes nearest: by what the Person must do, not by
    the PR's state.
- **Running is still.** T3's pending is a still amber dot; only a check's own
  row in the popover spins. Claude Code's users asked that a PR's icon not
  hide that the session runs, nor fade the state colours to grey.

## 4. When a PR changes

- **Who watches.**
  - **T3:** the Agent watches with a tool, and the app sweeps every 2 minutes.
  - **Claude Code:** Auto-fix, one toggle on the PR, and the app watches. Its
    prompt tells the Agent never to poll CI itself; an Agent that did spent
    $285 over 9.5 days on an idle draft.
  - **Codex:** nothing comes back into the thread. It is the most asked for
    since April (#19112).
- **What wakes the Thread (T3):**
  - checks that newly failed;
  - every required check passed;
  - a comment or a review by someone else;
  - no check after 15 minutes;
  - a new conflict.

  It wakes only on what is new since the last wake.
- **How it arrives:** as a message queued after the running turn: "Update on
  pull request #N (url), which T3 Code is watching for you: …", which ends by
  telling the Agent to stop watching before it hands the work back.
- **While watched, the Thread is Waiting**, never done or settled.
- **A watch ends:**
  - silently on merge;
  - with a message on close or after 8 failed reads;
  - after 10 wakes for comments alone in a row, so bots do not loop.
- **Claude Code's Auto-fix:**
  - a plain fix is pushed and explained;
  - an unclear request is asked first;
  - a duplicate is noted.
- **Merged and closed should reach the Agent**: Claude Code's users found
  they never did. T3 settles a Thread once all its PRs merged or closed after
  the Person's last message.

## 5. What can be done from the app

- **T3:**
  - merge, squash or rebase, with a default per Project;
  - auto-merge, ready or draft, close or reopen;
  - update branch, delete branch, revert;
  - approve workflows;
  - no re-run.
- **T3's one suggested action per PR**, in order: Resolve (conflicts, in a
  new Thread) → Ready (draft) → Fix (failing, in a new Thread) → nothing while
  pending → Merge. Merge asks: two clicks, "Merge now" turns "Confirm merge?"
  for 3 s.
- **Claude Code's cards:** Fix CI / Address comments / Resolve conflicts /
  Merge it each send that ask to the Thread as the Person's message. Merge
  when ready is GitHub's auto-merge, squash.
- **Codex:**
  - Fix puts the failing checks in the composer and waits for Send; Repair
    takes the conflicts.
  - The Codex app's own PR flow makes drafts, and updates an open PR in place
    without making it a draft again.
- **Their faults:**
  - T3 offers Merge without looking at the review.
  - Codex posts a comment to GitHub as soon as it is written.
  - Claude Code's chips cannot be dismissed (a closed PR kept "conflicting").

## 6. What Banda takes

1. **A link belongs to a Thread, and is never guessed from a branch.**
   - A Thread holds a list of links, each made by the Person (a URL or `#42`),
     by Create PR in Banda, or by the Agent (its `gh pr create`, read from its
     shell as T3 reads it, or a tool).
   - A PR the Person unlinked stays unlinked.
   - The PR knows its Threads back.
2. **One reader per Project, in the engine** (the `pulls` module of ADR 0034,
   decision 6):
   - batched reads through `gh`, with T3's pace;
   - a re-read after every push and merge;
   - mergeable and behind worked out by itself;
   - nothing per row, nothing in the Agent.
3. **What a PR needs, worked out from its state, is the one thing the bar
   shows.** In this order:
   1. conflicts;
   2. changes requested;
   3. checks failing;
   4. ready to merge (approved, or no review needed, and green);
   5. review required;
   6. checks running;
   7. draft;
   8. merged.

   With whose turn it is: the Person's, or an Agent's when its Thread is
   fixing it. T3's "Blocked on me" and Claude Code's "Waiting on you" are this,
   by PR.
4. **The app watches, not the Agent.**
   - A Thread's PR wakes it on what is new, as T3's watch: checks failed, all
     required passed, a review or comment, a conflict, merged, closed.
   - It is on for a PR the Thread made, and a toggle per PR (Claude Code's
     Auto-fix).
   - Off, the news goes to the Person: the bar, and a toast.
5. **The asks go to the Thread that owns the PR, as the Person's message.**
   Fix checks, Address comments, Resolve conflicts (Claude Code's cards), sent
   or put in its composer. Merge asks twice and names the method; Ready,
   Auto-merge.
6. **Still, never spinning.** A running check is an amber dot; the colour says
   the state; only the popover's rows may move (Roma, 2026-11-06).
7. **No GitHub, no PRs.** No `gh`, no remote on GitHub, or no sign-in: the PR
   parts say nothing, with one line in the popover on how to sign in, never an
   error on the bar.
