---
status: accepted
date: 2026-11-06
---

# A Thread's pull requests are watched, and the bar shows whose turn it is

ADR 0034, decision 6, planned the `pulls` module: GitHub through `gh`, a
Pane for a pull request, the PRs linked to a Thread, the Agent's tools,
and a watch that wakes the Thread. None of it is built. Thread details
has Create PR, and then forgets the PR it made.

Roma, on 2026-11-06, first asked for a widget with the branch and its PR
(`artifacts/git-branch/v1.html` in the brand workspace). Then: "agents
work on several PRs in a Project at once … I'd put the focus on the PRs
and their statuses", and "I like how PRs work in T3, Codex and Claude:
research first, then the model." The research is
`docs/research/2026-11-06-pull-requests.md`. In short:

- All three hold a list of PR links on the Thread. Codex and Claude Code
  first guessed the PR from the branch, and showed other Threads' PRs.
- T3 reads every linked PR of a Project from one reader, a minute apart,
  and wakes a Thread only on what is new.
- None of them shows, across the Agents, which PR waits on the Person.
  That is what the bar can do.

Roma looked at a second mock, centred on the PRs (`v2.html`), and decided
the points marked _decided_. The rest are our defaults and stay his to
change.

## Decision

1. **A Thread holds its pull requests; Banda never guesses them from a
   branch.**
   - A link names the PR (host, repository, number, URL), who made it
     (the Person, Create PR, or the Agent), and when.
   - It is made by:
     - Create PR in Thread details;
     - the Agent's `gh pr create`, read from the end of its shell call, as
       T3 Code reads it;
     - the Agent's tools `link_pull_request` and `unlink_pull_request`;
     - the Person, who pastes a URL or `#42` in the widget's popover.
   - A PR the Person unlinked is not linked again by the call that made
     it. A PR knows its Threads back.
   - The `pulls` module keeps the links, in the engine, by Thread. A
     Thread's fork does not take them.

2. **One reader per Project, in the engine.**
   - It reads the Project's linked PRs through `gh api graphql`, batched,
     signed in as the Person is: the state and draft, the title and the
     branches, the checks, the review and who it is asked of, mergeable,
     auto-merge, `+a −d`.
   - **The checks, summed up:**
     - any failure or cancel → failing;
     - else any pending → running;
     - else any success → passing.

     A re-run counts once, the newest.
   - **Its pace, as T3 Code's:**
     - open PRs every minute, or every 5 minutes once none has changed for
       30;
     - a merged or closed PR once more, then never;
     - at once after a push from Banda, Create PR, a merge, or the Agent's
       `gh pr merge`;
     - a rate limit stops it until GitHub's time to retry.
   - It reads only while a window or a watch needs the Project. Nothing in
     the window or the Agent polls.
   - Without `gh`, or without a sign-in, or in a repository not on
     GitHub, there are no PRs. The popover says how to sign in. The bar
     says nothing.

3. **What a PR needs, and whose turn it is.** The reader works out one need
   for each PR, the most urgent first:
   1. conflicts;
   2. changes requested;
   3. checks failing;
   4. ready to merge: passing, approved or no review required, not a draft;
   5. waits for review;
   6. checks running;
   7. draft;
   8. merged, or closed.

   Each need has a colour, and nothing moves while a check runs (_decided_:
   "no spinner in the icon, it distracts; just the status"):

   | Need | Colour |
   | --- | --- |
   | conflicts, checks failing | `--destructive` |
   | changes requested | `--attention` |
   | ready to merge | `--added` |
   | waits for review | a quiet blue |
   | checks running | `--working`, still |
   | draft | a ring, no fill |
   | merged | violet |

   **Whose turn:**
   - **The Person's:**
     - ready to merge and no auto-merge armed;
     - a review asked of the Person;
     - a draft whose Thread no longer works;
     - and, with Auto-fix off, conflicts, changes or failing checks.
   - **An Agent's:** its Thread works on the PR.
   - **Waiting:** checks run, a review asked of someone else, or auto-merge
     is armed.

4. **Auto-fix: Banda watches, and tells the Thread that works on the PR**
   (_decided_).
   - A PR made in a Thread (Create PR, the Agent's `gh pr create`) is
     watched from the start. Any other is watched once the Person turns
     Auto-fix on, in its row. The Agent's tool `watch_pull_request` turns
     it on too.
   - **The news that wakes it, each only once:**
     - checks newly failed;
     - every required check passed;
     - a review or a comment by someone else than the Person's account;
     - a new conflict;
     - merged or closed.
   - **It goes to the Thread that works on the PR:** the one that made
     it, or else the last that linked it. It is a message queued after the
     turn that runs, as Banda's: "Update on #595: 2 checks failed on
     3e1a9c0: Desktop window e2e (Linux), Licenses." A Thread that a watch
     may still wake is not done (ADR 0074's snooze "until it is done" waits
     for it).
   - **A watch ends:**
     - on merge, with a line to the Thread;
     - on close;
     - after 10 wakes in a row for comments alone, so two bots do not
       talk forever;
     - when the Person turns Auto-fix off.
   - **The Agent never polls GitHub for it.** Banda's Agent instructions
     say so, as Claude Code's do.

5. **The bar's widget, `pulls.status`, shows the focused Project's PRs**
   (_decided_).
   - It stands on the right (_decided_), and moves with Alt as every
     widget (ADR 0064).
   - The Project is the focused Pane's. With none, or no open PR, the
     widget is gone.
   - **Three looks, in `[widgets."pulls.status"] look` of `look.toml`, as
     the limits' (ADR 0055):**
     - `dots`, the default (_decided_): the pull-request icon and one dot
       per open PR, in its need's colour; six, then `+3`. A PR whose turn
       is the Person's has a soft halo of its own colour (_decided_,
       variant A), and the widget a faint tint.
     - `numbers`: the icon and up to three capsules, a dot and `#595`
       each, then `+2`.
     - `branch`: the focused Thread's branch, its prefix dim
       (`feat/`), and its PR's capsule.
   - **Motion, once and calm:**
     - a dot that changes need grows once and settles;
     - a new PR's dot pops in;
     - with `prefers-reduced-motion`, none.
   - The line on hover: "4 open pull requests · 1 your turn · 1 being
     fixed".

6. **The popover lists the PRs by whose turn it is.**
   - **Its head:** the Project's sign (ADR 0070) and name, how many are
     open, and This Project / All (_decided_; All groups by Project, as
     the Agents will be grouped by Project).
   - **Its groups:** Your turn, Agents on it, Waiting, Landed today
     (dimmed). A row moves between them as its turn changes.
   - **A row:**
     - the need's dot;
     - `#595` and the title;
     - the need in its colour, or what the Thread does ("Fixing 2 failed
       checks");
     - the checks (`✓ 4/6`);
     - the Thread's Harness and title, a still dot while it works;
     - an eye while Auto-fix is on.

     A click opens the Thread that works on the PR.
   - **One action per row:**
     - **Merge:** a second click within 3 s confirms ("Confirm squash?"),
       with the Project's merge method, squash by default. Shown in Your
       turn, and on a hover elsewhere when it can merge.
     - **Ready:** a draft whose Thread no longer works.
     - **Review:** opens the PR on GitHub, until `pulls.pull` (ADR 0034)
       shows it.
     - **Fix checks, Address comments, Resolve:** only with Auto-fix off.
       They send the Thread that works on the PR the Person's message at
       once (_decided_), and the row moves to Agents on it.
   - **Its menu:** Auto-fix on or off, Enable auto-merge, Re-run failed
     checks (`gh run rerun --failed`), Open on GitHub, Copy link, Unlink.
   - **Its foot:** when it last read ("synced 20 s ago"), Link a PR…, Open
     on GitHub.

7. **A toast only when the turn becomes the Person's, and the popover is
   closed:** "#595 is ready to merge · all checks passed". News an Agent
   acts on is not a toast.

8. **Not now.**
   - `pulls.pull`, the Pane with a PR's Summary, Code and Timeline (ADR
     0034, step 6). Its review, comments and merge options come with it.
   - `pulls.linked` and the PR's number on a Thread's row in the sidebar
     (ADR 0034, step 7).
   - Settling or archiving a Thread on merge (ADR 0069's Archive): the
     Thread gets the line, and the Person archives it.
   - Hosts other than GitHub, and GitHub's webhooks.
   - Stacked PRs.

## Consequences

- **ADR 0034:** decision 6 is built as this ADR says. Its step 7's links
  and watch come before its step 6's Pane.
- **ADR 0024, decision 5.4 ("the branch and its pull request"):** it is
  this widget's `branch` look.
- **`GLOSSARY.md`** gets **Pull request** (a PR linked to a Thread) and
  **Auto-fix**.
- **The order of work**, each step its own PR, tried in the window:
  1. This ADR and the research.
  2. The `pulls` engine: the links, the reader, `pulls.list` and the
     stream `pulls.watch` for a Project; Create PR and `gh pr create` link
     what they made.
  3. The widget's `dots` look and the popover, read only, opening a
     Thread.
  4. Auto-fix: the watch, the news to the Thread, the Agent's tools and
     instructions.
  5. The actions: Merge, Ready, Fix / Address / Resolve, the row's menu,
     Link a PR…, All Projects, the toast.
  6. The `numbers` and `branch` looks.
