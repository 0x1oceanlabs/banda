# Architecture review 3: where Banda stands on 2026-11-03

- **Date:** 2026-11-03.
- **For:** Roma, as the third architecture review. The second is issue #168; its open items (#160, #162, #163, #165, #166, #167) are still open and are named below where a finding touches them.
- **How:** read-only, nothing run. Ten reviewers each read one slice of `/home/roma/code/banda-worktrees/review-3` (main at 179f144): kernel, agents engine, agents in the window, the other modules, the shell, native, UI, cross-cutting (tests, CI, dependencies), performance and security. I merged what they found, opened the code to check every high finding and every finding that crosses slices, and ranked them.
- **Status:** research only. Tracking: #323; each finding has an issue (high and medium one each, low grouped by area). Nothing here is a decision. Ids are R3-01 … R3-73, in rank order.

## 1. Sources and limits

- I read the code at the paths named in each finding. Reviewers' line numbers are mostly right. Some have drifted: `kernel/src/passes.rs` is 59 lines, so the pass map is at :23-41, not :270-284, and `access.rs` is 138 lines. I fixed the refs I checked.
- Nothing ran: no `cargo test`, no `pnpm`, no `gh`. So these claims are **not checked**: the CI run IDs and flake counts in R3-26, the AppImage contents in R3-69, and every timing number ("hundreds of ms", "gigabytes of JSON"). The timing numbers are worked out from the code, not measured.
- I checked one claim against code outside the repo. The pinned Claude adapter (`~/.npm/_npx/e123f968897835b4/.../claude-agent-acp/dist/acp-agent.js:9032`) sets `settingSources: ["user", "project", "local"]`.
- I spot-checked these in the code myself: R3-01, R3-02, R3-03, R3-04, R3-05, R3-06, R3-07, R3-10, R3-11, R3-12, R3-13, R3-14, R3-16, R3-17, R3-21, R3-23, R3-24, R3-30 and R3-34 (the CI config part).

## 2. A map of the system

```
app/web (shell) ─┬─ registry/modules.ts ── modules/*/pane ── @banda/ui ── contract (generated from Rust)
                 └─ host.ts BRIDGE ── preload ── app/desktop (main) ── desktop-kit ── modules/*/desktop
                                                     │ child process
engine (banda) ── kernel ── modules/*/engine ── look / settings
                    │  one writer + one reader per Space (SQLite WAL)
                    ├─ outbox (effects)       ├─ Heard / react (reactions: git hears agents)
                    └─ api (WebSocket: owner secret or an Agent's pass) ── banda call / banda mcp
```

Dependencies mostly point the right way: modules → kernel, app → contract, and the shell names modules only in `modules.ts`. The exceptions are the subject of most cross-slice findings:

- `workspaces` names three other modules' Pane kinds and the browser's address rule.
- `git` reads the agents module's events by plain strings, in Rust and again in TS.
- `settings` depends on the agents and browser crates.
- The engine's module list is written in five places.
- About eight rules are written in Rust and again in TS by hand (R3-37).

### Module depth

| Part | Depth | Note |
|---|---|---|
| kernel `store`, `outbox`, `Heard` | deep | Small interface over transactions, receipts, retries and gap-free catch-up. |
| kernel `kernel.rs` | mixed | Routing, access and the Spaces registry in one 938-line file. |
| `methods!` | deep | One line gives the right, dispatch, tool, listing and TS type. Trait forwarding is still by hand (#167). |
| agents `rules/moves`, `writer`, `live` | deep | One pure `next`, a writer around it, a guard for live state. |
| agents `lib.rs`, `store.rs` | wide | Contract plus every operation (1325 lines). Sixty one-statement functions (1389 lines). |
| agents pane projection + `useLive` | deep | Pure reducers, checked against the engine (Thread only). |
| agents `session.ts` | wide | About 32 fields (#166). |
| terminal | deep | PTYs, history and resync behind five methods. |
| git `run.rs` | deep | The one git runner. The checkpoint reaction leans on agents' strings. |
| browser engine | shallow, on purpose | Checks input, then asks the window. The depth is in `desktop` (Effect services). |
| workspaces engine | deep model, leaky edges | Pure niri model. It names other modules. |
| skill | small, deep | Topics gathered at build time. |
| `Shell.tsx` | wide | 876 lines, a 14-member `Parts` (#162). The rules exist in TS, Rust and a diff layer (#160). |
| desktop `main.ts` | wide | Channels answered inline. `child.ts` and `ipc serve` are deep. |
| desktop-kit | thin, on purpose | Ports only. |
| ghostty | deep | About 4.5k vendored lines behind 15. |
| look | deep, overloaded | Also holds the generic settings-file machinery that module engines need (R3-66). |
| settings writer | deep | toml_edit, check before write, atomic rename. |
| `check.sh` | deep | Test harnesses and pollers are copied per crate (R3-70). |

## 3. What is solid

Keep these as they are:

- **The store's one writer.** The receipt commits with the events and outbox rows. Events are published after commit. The log refuses UPDATE and DELETE. Migrations refuse a newer database.
- **The outbox.** It claims under a boot, keeps per-key order and backoff, turns a panic into Fail, and commits `done_writing` with the module's write. Kernel tests cover the failure modes.
- **`Heard`.** It subscribes before it reads, so there is no gap and no repeat. The API's `follow` reuses it.
- **Access.** One exhaustive `decide` plus `within`, tested for every right.
- **`methods!` and generated contract types.** The drift check in `check.sh` holds ADR 0014.
- **Agents rules.** `rules::next` is pure with table tests. `TurnRun` is a drop guard. Question secrets stay in memory.
- **Terminal.** One piece in flight, a snapshot for a watcher that fell behind, and a close that reaches the whole process group.
- **git `run.rs`.** No prompts, no optional locks, a cleaned environment, caps, a timeout, a semaphore, and stderr kept out of refusals.
- **The window shell.** Broken args are caught per Pane, there is one module list, and changes run in order and are rolled back on refusal.
- **The bridge.** One typed table. Every channel checks the sender and decodes with Schema.
- **Electron settings.** Sandbox, contextIsolation and a strict CSP. Webviews are kept out of Banda. Visuals are isolated in depth.
- **The settings writer.** It keeps comments, checks before it writes, and writes atomically. Rows come from Rust schemas.
- **CI.** The fork guard runs at the runner. Unstable marks only go down. `window.json` and the types are checked for drift. e2e windows run on throwaway folders with a fake Harness only.

## 4. Findings by rank

Severity comes first. Within a severity: bugs and security, then costs, then knowledge leaks, then docs and tidiness. "cross" means a finding only shows when two slices are put side by side.

| Id | Title (short) | Sev | Cross | When |
|---|---|---|---|---|
| R3-01 (#324) | A repo's `.claude/` hooks run with no trust step | high | yes | now |
| R3-02 (#325) | Banda's git runs the repo's fsmonitor, filters, hooks | high | yes | now |
| R3-03 (#326) | Tool output rewrites its whole body every 80 ms | high | yes | now |
| R3-04 (#327) | An Agent reaches a freer mode through another Thread | medium | yes | now |
| R3-05 (#328) | An engine failure spoils a command ID for good | medium | yes | now |
| R3-06 (#329) | A Space that does not open vanishes, and is added twice | medium | yes | now |
| R3-07 (#330) | One read error ends git's checkpoints silently | medium | yes | with #305/#306 |
| R3-08 (#331) | `agents.thread` / `read` is unbounded (16 MiB) | medium | yes | now |
| R3-09 (#332) | Turns are ordered by when they were made | medium | no | now |
| R3-10 (#333) | A fork copies a waiting turn that never starts | medium | no | now |
| R3-11 (#334) | Settings writes race | medium | yes | now |
| R3-12 (#335) | One broken settings file freezes the whole look | medium | no | now |
| R3-13 (#336) | `useLive` leaks a follow on overlapping reads | medium | yes | now |
| R3-14 (#337) | The Pane's `can` misses `stopping` | medium | yes | with-feature |
| R3-15 (#338) | The live Thread list disagrees with the engine's | medium | yes | now |
| R3-16 (#339) | The drawer's Thread calls while it is read | medium | no | now |
| R3-17 (#340) | A terminal outlives a Pane no window saw leave | medium | yes | now |
| R3-18 (#341) | A Turn's Diff can be wrong without saying so | medium | yes | now / #307 |
| R3-19 (#342) | An engine that will not start: "Connecting…" forever | medium | yes | now (log) / step 7 |
| R3-20 (#343) | No recovery when the page's renderer dies | medium | no | now |
| R3-21 (#344) | CI skips skill topics as "only Markdown" | medium | yes | now |
| R3-22 (#345) | Agent-openable rules live in 4 places; `file:` gets in | medium | yes | ADR 0029 step 4 |
| R3-23 (#346) | The wall holds only against an Agent with no shell | medium | yes | later (ADR) |
| R3-24 (#347) | `browser_tabs` reads every Space's tabs | medium | no | ADR 0029 step 4 |
| R3-25 (#348) | Release packs from shared runner volumes | medium | yes | ADR 0033 step 5 |
| R3-26 (#349) | CI's retry hides e2e flakes | medium | no | now |
| R3-27 (#350) | e2e reads moving layout and waits fixed times | medium | no | with #258/#309 |
| R3-28 (#351) | `check.sh` can fail with no word | medium | no | now |
| R3-29 (#352) | The glass is decided by a 300 ms race | medium | no | #192 |
| R3-30 (#353) | The Thread list parses every body; missing indexes | medium | yes | with #249 |
| R3-31 (#354) | One reader per Space; the event query skips its index | medium | yes | now |
| R3-32 (#355) | Diff cache by path; timeline fold per frame | medium | yes | now |
| R3-33 (#356) | Each Thread Pane follows the whole list | medium | no | with #166 |
| R3-34 (#357) | CDP queues without bound in Electron main | medium | yes | now |
| R3-35 (#358) | The Harness list is read once per mount | medium | yes | #172 |
| R3-36 (#359) | Two "wait for you" numbers, two rules | medium | yes | now / bar ADR |
| R3-37 (#360) | Rust rules copied by hand in TS (8 places) | medium | yes | with-feature |
| R3-38 (#361) | git hears agents by strings; its test fakes agents | medium | yes | now |
| R3-39 (#362) | Receipts decided by right; CLI promises safe repeat | medium | yes | #167 |
| R3-40 (#363) | `home` is whichever Space sorts first | medium | no | first run (#314) |
| R3-41 (#364) | `architecture.md` and ADRs no longer match | medium | yes | now |
| R3-42 (#365) | agents `lib.rs` mixes contract and operations | medium | no | with next post-a-message command |
| R3-43 … R3-73 | low | | | see below |

### High

**R3-01. A Space added from a cloned repo runs that repo's Claude Code hooks and permission rules, with no trust step.**
- Refs: `modules/agents/engine/src/acp/opening.rs:143-145`, the adapter's `acp-agent.js:8933, 9032`, ADR 0026.
- Scenario: someone clones a hostile repo and adds it as a Space. Its `.claude/settings.json` holds a SessionStart hook (`curl …|sh`) or `permissions.allow: ["Bash(*)"]`. The first Claude Thread runs the hook as the Person, or runs shell commands without a Question, even in Supervised mode. Claude Code's own CLI asks "Do you trust this folder" first. Banda never asks.
- Fix: add a per-Space `trusted` flag that only the Person sets (Manage). Add Space asks when it finds `.claude/`, `.mcp.json` or `.codex/`. Until the Space is trusted, sessions open with `_meta.claudeCode.options.settingSources = ["user"]`. Find Codex's equivalent. Add an e2e test that records the `_meta` the fake Harness gets.
- When: now, before the open-source step (ADR 0033 decision 10). Cost M.

**R3-02. Banda's own git runs the repo's fsmonitor, clean filters and reference-transaction hook as the Person, on every turn.**
- Refs: `git/engine/src/status.rs:24`, `checkpoint.rs:76,93,110,140-150`, `diff.rs:331-338` (`INDEX` is applied per call), `run.rs:185-203`, and a second, unhardened runner at `agents/engine/src/files.rs:63-72`.
- Scenario: an Agent under prompt injection, in a mode that allows edits, writes `core.fsmonitor = sh -c …` or a filter in `.gitattributes`. When its turn ends, Banda's checkpoint runs that command outside the Thread's mode and outside the Harness's sandbox.
- Fix: put one safe prefix in `run.rs`'s `git()`: `core.fsmonitor=false`, `core.hooksPath=/dev/null`, no untracked cache, and an empty attribute source for add, write-tree and status. Move `files.rs` onto that runner. Add a test where a marker file must stay absent.
- When: now, before ADR 0034 step 3 adds more git commands. Cost S.

**R3-03. Every 80 ms tick of a command's output rewrites the tool call's whole JSON body, up to 4 MB, on the Space's one writer.**
- Refs: `agents/engine/src/transcript.rs:477-512`, `store.rs:909-940`, `transcript/output.rs:8`, `acp/routes.rs:40` (an unbounded channel feeds it).
- Scenario: a 4 MB build log is about 250 or more ticks, each of which parses and writes about 2 MB. That is quadratic. Every other Thread and command in the Space waits behind the writer, and what the Harness says piles up unbounded.
- Fix: keep output out of `body`. Use an append-only `agents_output` table, or an `output` column with `|| ?`. Patch status and title on their own. Assemble the output when the view is read. Pair with R3-08.
- When: now. Cost M. Reported by both the agents-engine and performance reviewers.

### Medium

**R3-04. An Agent can reach a freer mode than its own Thread's.**
- Refs: `agents/engine/src/rules/to_thread.rs:17-41`, `lib.rs:1078-1085`, `rules/message.rs:10-17`, `modules/skill/SKILL.md:40-43`, ADR 0019:52-54.
- Scenario: a Supervised Agent reads a poisoned page. It `send`s "run X" into a sibling Thread set to full access, and that Thread runs X with no Question. Or it follows the skill: `banda settings set harnesses.toml harness.claude.start.mode`, then starts a new Thread.
- Fix: an Agent's message runs at most at its sender's mode. A new Thread starts at the lower of the two modes, or the message waits as a Question. Take `mode` out of what the skill tells Agents to set. Add a test for each path.
- When: now. Cost S.

**R3-05. An engine failure inside a command is kept as that command's receipt.**
- Refs: `kernel/src/kernel.rs:446-451`, `store.rs:206-241`, `contract/src/engine.ts:146-170`.
- Scenario: `agents.send` hits a short SQLite I/O error. `Kernel::call` stores `internal` against the command ID. Every repeat with that ID, the Pane's re-send and the CLI's "repeat it safely", gets `internal` forever. This goes against ADR 0002 decision 2 as `store.rs` itself states it.
- Fix: keep only the access decision's refusals and `Error::Refused`. Do not keep `Internal`, and decide what `MayHaveRun` should do. Add a test.
- When: now. Cost S.

**R3-06. A Space that does not open drops out of the list with only a log line, and Add Space then makes a second Space for the same folder.**
- Refs: `kernel/src/outbox.rs:126-161`, `space.rs:236`, `kernel.rs:183-218, 660-701`, `agents/engine/src/effects.rs:125`, `agents/engine/tests/agents.rs:696-720`, `kernel/tests/kernel.rs:331-354`.
- There are three causes:
  1. A module's `settle` fails during recovery. For example, a changed `TurnEffect` shape fails to decode on every start.
  2. The lock is still held by the last kernel. This is the cause of #295: the restart helpers open a new kernel right after `shutdown_timeout`.
  3. The manifest does not read.
- Fix: recovery never blocks opening; a failed settle marks the row failed in a kernel-only transaction. Add `Entry::Failed { why }`, listed like `missing`, so Add Space and Locate find it. Add an async `Kernel::close()` that returns once every Space has let go, and use it in the restart helpers.
- When: now, as one kernel PR. Cost M. Known in part: #295.

**R3-07. One read error ends git's reaction for the rest of the engine's life, and nothing says so.**
- Refs: `git/engine/src/checkpoint.rs:116-130`, `kernel/src/space.rs:580-609`, ADR 0002 decision 3, `architecture.md:186`.
- The error path is `Err(error) => { warn; return }`. The dropped watch is then pruned, so `reacted` stops waiting for it. Every later turn in that Space gets no checkpoint and Diff falls back without a word.
- Reactions are a second path for side effects next to the outbox, and the docs say this path does not exist.
- Fix: loop on transient errors with a backoff. The larger fix: modules declare `reacts_to()`, `Tx::emit` enqueues outbox rows, and START waits only on its own rows. That solves #305 and #306 together and lets `Heard`'s `handled` watch go.
- When: the small loop fix now. The outbox fold with #305/#306. Cost S, then M. Known: #305, #306 (symptoms only).

**R3-08. `agents.thread` answers every item whole, and the Agents' `read` tool returns that same view.**
- Refs: `agents/engine/src/lib.rs:204, 566-596`, `kernel/src/api.rs:261-265`, `engine/src/client.rs:30`, `mcp.rs:122,155-162`, `architecture.md:472`.
- Scenario: a Thread with a few large outputs passes tungstenite's 16 MiB frame limit. `banda call` and `banda mcp` then break with "the engine closed the connection". Below the limit, the Agent's context fills with old outputs and JSON scaffolding instead of the latest reply.
- Fix: in `ThreadView`, give each output its tail plus its length, with an `agents.output {item, from}` page call. Give `read` a lean text answer of its own. Set the client's `max_frame_size`.
- When: now, with R3-03. Cost M.

**R3-09. A Thread's turns are ordered by when they were made, not when they ran.**
- Refs: `agents/engine/src/rules.rs:139-146`, `store.rs:668-690, 773-776, 869-870`, `lib.rs:1314-1319`, `writer.rs:238-245`.
- Scenario: a retry in a held queue runs before the turns that already waited. Afterwards, `can.retry`, the sidebar's latest turn, fork and rewind all pick the wrong turn.
- Fix: give each turn a run order, set when it starts. Use it in `position`, `last_begun`, `copy_turns` and `rewind`. Add a scenario test.
- When: now, with #249. Cost M.

**R3-10. A fork can copy a waiting turn that then never starts.**
- Refs: `agents/engine/src/store.rs:773-826`, `rules/moves.rs:217-223`, `writer.rs:238-245`, ADR 0018 decision 2.
- `copy_turns` copies the turn's state as it is, outside the writer, and no START is enqueued. The copy shows queued forever, and the fork can never be rewound.
- Fix: copy only turns that ended, or refuse the fork. Say in `architecture.md` that fork and rewind work outside the writer.
- When: now. Cost S.

**R3-11. Settings writes race.**
- Refs: `app/desktop/src/settings.ts:28-81`, `settings/src/write.rs:144-165, 332-342`, `app/web/src/settings/SettingRow.tsx:352-383`, `modules/browser/desktop/src/browser.ts:97-107`, `app/ui/src/hooks/use-write.ts`.
- Each `set` runs as its own `banda settings` process: it reads the file, edits it and renames it, with no lock. The Many control and the browser's pins work out the next list from a look that may be 250 ms old.
- Scenario: two quick clicks in Counts, or two pins in a row, and the first one is lost.
- Fix: a `Semaphore(1)` per file in the Settings service. Keep the pending value locally until the look catches up. Give lists an add/remove in Rust.
- When: now. Cost S. Reported by both the native and UI reviewers.

**R3-12. One settings file that does not parse freezes every other file's look.**
- Refs: `look/src/lib.rs:933-944`, `theme.rs:299`, `file.rs:136-140`, `look/tests/resolve.rs:465-484`.
- When any file is "left out whole", `follow` keeps the last good look for all files. A typo in `sidebar.toml` makes theme clicks do nothing, and no refusal shows. ADR 0016 decision 2 promises this per file.
- Fix: keep the last good value per file. Add a follow test that breaks one file and changes another.
- When: now. Cost M. Near #258.

**R3-13. `useLive` can run two starts at once and lose a follow that never ends.**
- Refs: `app/ui/src/hooks/use-live.ts:75-130`, `modules/git/pane/src/DiffPane.tsx:143-189`.
- A `round` bump or READ_AGAIN while a read waits makes two follows. The shared `unfollow` drops one, which then lives past unmount and is subscribed again on every reconnect. DiffPane meets this whenever `turn.ended` arrives while the window comes to the front.
- Fix: a generation counter, plus a local `off` per follow. Add fake-Engine tests: useLive is the read path for every Pane and has no tests.
- When: now. Cost S.

**R3-14. The Pane's copy of `rules::can` cannot see a turn that is stopping.**
- Refs: `agents/pane/src/thread.ts:163-215` (:199), `agents/engine/src/rules/moves.rs:198-200`, `writer.rs:162-166`, `effects.rs:374-392`, `rules.rs:26-38, 88-118`, ADR 0014:52.
- No fact says `stopping`. During GiveWay on a Harness that cannot steer, the window offers Steer and "Send now", and the engine refuses them. Engine-side `can` and the command helpers also build partial `TurnFacts` by hand, without `stopping`.
- Fix: the engine emits `can`, or a `turn.stopping` fact, and `withCan` goes. Commands use `writer::takes` with the full facts. Add a checkpoint while the cancel is delayed.
- When: with-feature (the next `rules::next` change, or #214). Cost M.

**R3-15. The live Thread list disagrees with the engine's, and nothing checks it.**
- Refs: `agents/pane/src/list.ts:96-115`, `agents/engine/src/store.rs:666-685`, `between.rs:280-293`, `thread.ts:453-458`, `checkpoints.test.ts:17-40`, `agents.rs:168-205`.
- `applyThreads` takes the turn that ended last. `last_begun` takes the turn made last that began. The by-itself notice's `turn` also differs between the fact and the store.
- Scenario: the sidebar stays "done" with the Pane focused until a reload.
- Fix: record list checkpoints, make `applyThreads` follow `last_begun`, and fix the notice's `turn` in one place.
- When: now. Cost S.

**R3-16. The drawer's Thread is invisible to the calls.**
- Refs: `app/web/src/shell/Shell.tsx:282-300, 440-444, 781-784`, `calls/sight.ts:31-47`, `workspaces/Drawer.tsx:100-111`.
- `sightOf` reads only the workspaces. A Question in the drawer the Person is reading plays its sound and shows a toast, and the sidebar never marks the drawer's Thread as current.
- Fix: one "looked at" function (the drawer's entry first) for sight, seen, `isCurrent` and settle.
- When: now, before 8c (pop-out), which needs the same idea. Cost S.

**R3-17. A terminal's program outlives its Pane when no running window sees the Pane leave.**
- Refs: `app/web/src/settings/Agents.tsx:36-78`, `modules/terminal/pane/src/TerminalPane.tsx:58-78`, `Shell.tsx:316-328`, `terminal/engine/src/lib.rs:29-32, 120-129`.
- `terminal.close` runs only from Shell's `left()` over the workspaces. Closing the sign-in dialog in Settings › Agents leaves the sign-in program running, and each retry adds one. So does `workspaces.close` from the CLI with no window open.
- Fix: a `useHostedPane` helper that runs `closedOf` wherever a Pane is drawn (dialog, drawer, pop-out). Add `terminal.list`, so a window closes orphans from the state rather than from what it saw.
- When: now (the dialog part). Cost S.

**R3-18. A Turn's Diff can be wrong without saying so.**
- Refs: `git/engine/src/checkpoint.rs:65-70, 127-129, 150-155`, `diff.rs:126-139`, `model.rs:219-264`, `git/pane/src/DiffPane.tsx:109-113, 170-179`, `run.rs:338-356`.
- There are two ways:
  1. With no "after" ref (more than 5000 untracked files, or git failed), the turn compares with now, so the Person's later edits show as the Agent's.
  2. The Pane treats any `conflict`, timeouts and locks included, as "no checkpoint" and shows only the tool-call changes. The Pane is reading Rust's Reason-to-code mapping.
- Fix: put `until: ended | now` on `Diff`. Fall back only when there is truly no checkpoint or no repo. Show other errors with Retry.
- When: the fallback now. The notice with #307. Cost S. Known in part: #307.

**R3-19. An engine that will not start leaves the page on "Connecting…" forever, and the reason goes only to stderr.**
- Refs: `app/desktop/src/child.ts:21-22, 46-49`, `engine.ts:87-90`, `app/web/src/bar/Bar.tsx:204-211`, `engine/src/main.rs:295-300`, ADR 0033:71.
- Scenario: a Dev AppImage whose migration fails, or a held `engine.lock`, restarts the engine every 10 s with no word on screen. ADR 0033 decision 9 promises a crash reporter and an engine log; no step builds them.
- Fix: keep the child's last stderr lines and exit code as an `engine.down` status, and show it in the bar. Write `state/engine.log`. Start `crashReporter` locally.
- When: the log now. The status with step 7. Cost M.

**R3-20. Banda's page has no recovery when its renderer dies or a load fails.**
- Refs: `app/desktop/src/main.ts:392-464`.
- There is no `render-process-gone` or `did-fail-load` handler. An out-of-memory or GPU reset leaves an empty window.
- Fix: reload, at most N times a minute. The arrangement lives in the engine, so a reload restores the window. Add an e2e test with `forcefullyCrashRenderer`.
- When: now. Cost S.

**R3-21. CI skips PRs that change only Markdown, but the skill's topics are Markdown compiled into `banda`.**
- Refs: `.github/workflows/ci.yml:48`, `modules/skill/build.rs:16-34`, `src/lib.rs:113-131`.
- A broken front matter makes `banda skill` and `banda mcp` panic on main, and auto-merge lets it through.
- Fix: add `**/skill/*.md` and `modules/skill/SKILL.md` back as code, or exclude only `docs/` and the root `*.md`.
- When: now. Cost S.

**R3-22. What an Agent may open is decided in four places with four answers, and the desktop's rule lets `file:` through.**
- Refs: `modules/browser/desktop/src/browser.ts:56,131,199-201,243-251`, `browser/engine/src/lib.rs:356-367`, `workspaces/engine/src/lib.rs:80-120,564-572,688-701`, `workspaces/engine/src/model.rs:135-147`, `browser/pane/src/address.ts:44-49`.
- The rules: `OPENS = /^(https?|about|file):/`, `address()` (http/https), `web_address()` (http/https, a copy), and `pageAddress` (adds data:/blob:). `AGENT_KINDS` names three other modules' kinds, and `Shown::upgrade` builds git's args.
- Scenario: a link on an Agent-driven page opens `file:///home/…` in a new tab. `browser_snapshot` checks no URL, so the Agent reads local files.
- Fix: the browser owns one scheme rule in the contract. snapshot and act refuse `file:` for Agents. A PaneKind declares itself Agent-openable, with its own args check routed through the kernel.
- When: with ADR 0029 step 4, or ADR 0037 step 4 (Preview, the next Agent-openable kind). Cost M. Known in part: #165.

**R3-23. The Space wall and the Agent-tool guards hold only against an Agent without a shell.**
- Refs: `engine/src/client.rs:21-25`, `main.rs:381`, `places.rs:151-165`, `modules/browser/desktop/src/cdp.ts:585-590`, `browser/skill/browser.md:75-90`, ADR 0032:23-27, ADR 0019:52.
- `banda call` always uses the owner secret from `engine.json`. An injected Agent with any approved shell command can answer its own Questions or flip `sees_others`.
- The skill sends every Agent to the raw CDP endpoint. That skips the http-only rule, hands.ts's password-field refusal and the Person's stop (#154).
- Fix: the CLI uses `BANDA_TOKEN` when set. `engine.json` carries a secret without Decide or Manage; the full secret travels only to the window. The skill names the `browser_*` tools (ADR 0029 step 6). Longer term: peer credentials, and CDP scoped per Thread.
- When: the CLI token and the skill now (S). The split secret needs an ADR that amends 0019 and 0032. Cost M.

**R3-24. `browser_tabs` and `browser_snapshot` read every Space's tabs, past the wall ADR 0032 keeps for Pane args.**
- Refs: `browser/engine/src/lib.rs:234-245`, `workspaces/engine/src/lib.rs:540`, ADR 0029:44-46, 101-103.
- Scenario: an Agent in Space A, with `sees_others` off, reads the mail tab of Space B's browser.
- Fix: Roma decides. One proposal: list tabs in the call's Space, show others only with `sees_others`, and refuse snapshot and act outside the Space.
- When: ADR 0029 step 4. Cost M.

**R3-25. Release: Dev is packed on runner volumes that unmerged PRs also write, the app sets no Electron fuses, and a Stable tag is not tied to a green `ci`.**
- Refs: `.github/workflows/release.yml:12-13, 47-66`, `ci/compose.yaml:24-29`, `ci/target.sh:12`, `ci/README.md:11-13`, `app/desktop/electron-builder.config.mjs:11-39`, ADR 0033:50-56.
- Scenario: a poisoned build.rs in a Renovate PR leaves an artifact in a runner's `target/`. The next main push packs Dev from it, and Dev updates itself silently.
- Fix: pack on a fresh volume. Pin actions by SHA. Publish sums. Set the fuses. Check that `ci` passed on the tagged SHA.
- When: ADR 0033 step 5, and before the repo goes public. Cost M.

**R3-26. CI's retry hides e2e flakes.**
- Refs: `app/desktop/playwright.config.ts:10-11`, `.github/workflows/ci.yml:73`, `e2e/window.ts:33`, `e2e/speed.spec.ts:117`.
- The reviewer counted 8 of about 25 green runs with a flaky test. I did not check the count. The config is confirmed: `retries: 1`, only the `list` reporter, and traces uploaded only on failure.
- Fix: add the `github` reporter and upload `test-results/` with `if: always()`. Optionally fail when a flaky test's issue is closed.
- When: now. Cost S. Related: #309, #275 (closed, said to still flake).

**R3-27. e2e tests read layout that is still moving, wait fixed times, and talk through files written in place.**
- Refs: `app/desktop/e2e/window.ts:63-123, 182-184`, `app/web/src/look.ts:102-105`, `window.spec.ts:323-325, 2082-2084, 2845-2846`, `settings.spec.ts:78-80`, `tools/fake-agent/src/main.rs:1164-1166`.
- Fix: reduced motion by default, `expect.poll` instead of fixed waits, a positive sync point for "nothing happened" checks, and atomic writes in the e2e helpers and the fake agent.
- When: with #258 and #309, which are two cases of this. Cost M.

**R3-28. `check.sh` can fail with no word.**
- Refs: `scripts/check.sh:23-32, 63-77`.
- `quiet` turns the real status into 1, names no command, and there is no ERR trap. Run 41633912732 on #290 went red with nothing in between (reported by the reviewer, not checked).
- Fix: an ERR trap that names `$BASH_COMMAND`. `quiet` keeps and prints the status. Check whether `--silent` on the e2e line still hides what the line-23 comment warns about.
- When: now. Cost S.

**R3-29. The system glass is decided by a look that must arrive within 300 ms.**
- Refs: `app/desktop/src/main.ts:150, 295-298, 374-404, 442`, `look.ts:55-62`.
- On a cold AppImage start, the glass is off for the whole session. With #241 this becomes the default path on macOS and Windows.
- Fix: keep the last glass choice in the window's profile and open from it.
- When: #192 / PR #241. Cost S. Known: #192.

**R3-30. The Thread list parses every item body in the Space, and two indexes are missing.**
- Refs: `agents/engine/src/store.rs:29-53, 322-329, 490-510, 629-636, 959-999`.
- `threads()` is N+1, with `json_extract` on every body and a correlated EXISTS with no `agents_turns(message)` index. `open_questions` scans every item on each turn's end. `visual_ids` parses every body.
- Fix: add indexes on `agents_turns(message)` and `agents_items(turn)`. Make `kind` and a question's `state` columns with a partial index. Keep the latest message on the Thread row.
- When: with #249. Cost M. Known in part: #249.

**R3-31. One reader connection per Space, and an event query that cannot use its subject index.**
- Refs: `kernel/src/store.rs:1-6, 38, 77, 169-170, 264-279`, `events.rs:112-140`, `space.rs:446-452, 593-613`, `git/engine/src/checkpoint.rs:157-171`, `agents/engine/src/effects.rs:418-438`.
- Every read in a Space waits behind one Mutex, START's `reacted()` → `at()` included. `(?2 IS NULL OR …)` makes a Thread's facts, and git's rewind, scan the log.
- Fix: a small pool of `query_only` readers. Build the WHERE from the filter's terms. Add an `EXPLAIN QUERY PLAN` test.
- When: now. Cost S. Reported by both the kernel and performance reviewers.

**R3-32. The Pane's diff cache is keyed by path alone, and the timeline is rebuilt in O(turns × lines) every frame.**
- Refs: `agents/pane/src/changes.ts:22-62`, `timeline.ts:34-38, 102-178`, `ToolCall.tsx:53-61`, `ThreadPane.tsx:401`, `diff.ts:13-15`.
- One file edited in several turns evicts its own entry, so Myers diffs run again every frame while a reply streams.
- Fix: cache by identity (WeakMap on the part, or per turn on the item array). Index lines by turn once.
- When: now. Cost S.

**R3-33. Each Thread Pane follows the whole Space list and redraws its whole transcript on any Thread's event.**
- Refs: `agents/pane/src/ThreadPane.tsx:144, 400-478, 766-788`, `ThreadsWatch.tsx:21-22`, `timeline.ts:102-147`, `app/web/src/settings/SpacesSettings.tsx:69`.
- Fix: one ref-counted list per Space, Writers kept stable, `Entry` memoized.
- When: with #166. Cost M.

**R3-34. The CDP endpoint queues each client's messages without bound in Electron main, and keeps closed tabs in `byTarget`.**
- Refs: `modules/browser/desktop/src/cdp.ts:159-185, 203, 287, 369-378, 600-605`.
- A stalled Playwright with screencast on grows main's heap. Main also handles the window's input.
- Fix: a byte cap per client, after which the socket closes. Delete the entry when a tab is gone.
- When: now, or with #300. Cost S.

**R3-35. The Harness list is read once per mount, so the sidebar and a new Thread never hear a change.**
- Refs: `agents/pane/src/harnesses.ts:9-17`, `ThreadsWatch.tsx:23`, `session.ts:77-83`, `AgentsSettings.tsx:101-115`.
- Fix: one window-wide store read again on front and after a settings write, or an engine fact.
- When: #172. Cost S. Known in part: #172.

**R3-36. Two "wait for you" numbers in the bar are counted by different rules.**
- Refs: `app/web/src/bar/Bar.tsx:54-58`, `counts.ts:29-34`, `Counts.tsx:22-28`, `agents/pane/src/marks.ts:39-49`, `app/ui/src/components/banda-mark.tsx:57-64`, `architecture.md:751-753`.
- The Mark counts asking and failed, and ignores settled. Counts uses `waits` (asking, failed, offline, done) minus settled.
- Fix: one rule, in banda-mark, worked out by the window from the lists.
- When: now (S), or with the bar widget ADR.

**R3-37. About eight rules are written in Rust and again in TS by hand, and two already differ.**
- Refs: `agents/engine/src/model.rs:863` vs `agents/pane/src/list.ts:15,86` (chars vs UTF-16); `rules/message.rs:45-53` vs `pane/src/images.ts:7-14`; `Composer.tsx:241-245` (120,000 characters, the window only; `Queue.tsx:156` checks nothing); `changes.rs:107-134` vs `changes.ts:44-62`; `look/src/keys.rs:78-106` vs `app/web/src/actions/actions.ts:61-92`; `engine/build.rs:7-12` and `places.rs:75-81` vs `app/desktop/src/channel.ts:17-57` (Windows path differs); `engine/src/serve.rs:72-80` vs `app/desktop/src/engine.ts:21-32` (hand Schema, `protocol` ignored); `look/src/settings.rs:388-437` vs `app/ui/src/sound/settings.ts`, `calls/settings.ts` and `globals.css:156-201` (untested); `git/engine/src/run.rs:338-356` read by `DiffPane.tsx:109-113`.
- Fix: one pattern for all of them. Export consts and types from Rust (ts-rs, as `VERSION.ts` already is), or add a contract test against `banda` output for each copy. Enforce the text limit in `may_send` and `may_change`.
- When: each with its next change. The Windows path with #241. Cost S each.

**R3-38. git reads the agents module's facts by plain strings, and its Rust test fakes agents.**
- Refs: `git/engine/src/checkpoint.rs:17-29, 133-137, 157-171`, `git/pane/src/DiffPane.tsx:103,166,180-185`, `git/engine/tests/git.rs:16-45`, `agents/engine/src/model.rs:940-965`, `contract/src/generated/EventFilter.ts:6-10`.
- Renaming `turn.ended`, or nesting `turn`, passes every Rust test. A missing `turn` is skipped silently.
- Fix: type the Pane's filters as `Fact["kind"][]`. Add one engine-level test that runs the real agents and git. Warn on a missing `turn`. Note in git's `module.toml` that it hears agents.
- When: now, before #214 and #308 touch these facts. Cost S.

**R3-39. The kernel decides whether a call keeps a receipt by its right, not by whether it is a command, and the CLI promises a safe repeat for every call.**
- Refs: `kernel/src/kernel.rs:430-438`, `methods.rs:415-425`, `engine/src/main.rs:259-266`, `client.rs:76-106`, `mcp.rs:157-160`, `browser/engine/src/lib.rs:470-483`, `terminal/engine/src/lib.rs:56-62`.
- Scenario: `browser.act` repeated "safely" clicks twice. Each refused tool call writes a receipt nobody reads.
- Fix: `methods!` gives the method's kind with its right. Receipts are kept only for commands. The CLI offers the safe repeat only for a command.
- When: #167. Cost S. Known in part: #167.

**R3-40. `home` is whichever Space the picker sorts first.**
- Refs: `app/web/src/App.tsx:45-48`, `app/ui/src/lib/spaces.ts:11-15`, `Shell.tsx:237-243, 459-474, 788-791`, ADR 0025:270-279.
- Pinning a Space moves where the drawer and new Threads go, and re-sends `workspaces.take`, which the engine refuses.
- Fix: make the default Space an explicit fact. Run `moveOver` once.
- When: first run / Guide (#314). Cost S.

**R3-41. `architecture.md` and several ADRs no longer describe the code.**
- Refs: `docs/architecture.md:40-58, 186, 201-206, 220-225, 268-279, 634-643, 843-878`, `docs/adr/0014-…:52`, `docs/adr/0037-…:102-104`, `GLOSSARY.md`, `git/engine/src/lib.rs:7-10`, `browser/pane/src/index.ts:1-3`, `browser/pane/src/desktop.ts:3`, `skill/src/lib.rs:1`, `app/web/src/workspaces/store.ts:1-17`, `app/desktop/src/main.ts:1-12`, `agents/pane/package.json:7`.
- What is wrong:
  - Reactions are never mentioned, and line 186 says side effects never start from a subscription.
  - The browser row says the browser has "no engine part".
  - There is no git or workspaces row, and the Repository tree lacks five folders.
  - `.git` writes are missing from "Where data lives".
  - "The page gets one thing" is no longer true: `settings.set` can write `harnesses.toml`'s `command`.
  - ADR 0014 says the Pane keeps no `can` rule.
  - ADR 0037's sandbox is looser than what ships.
  - "Checkpoint" and "call" each mean two things.
  - The window's storage and keys.toml are missing.
- Fix: one docs PR: Reactions, git and workspaces sections, the table, the tree, data, the bridge, and both ADR amendments. Glossary entries for Checkpoint, Diff, Desk, Look and Glass.
- When: now. Cost S. Five reviewers found parts of this.

**R3-42. agents `lib.rs` mixes the contract with every operation, and the writer calls back into it.**
- Refs: `agents/engine/src/lib.rs:947-1215`, `writer.rs:212-226`, `effects.rs:243-246`.
- `send` takes seven arguments and two flags. There are two `Message` types.
- Fix: move the operations to `thread.rs` and `fork.rs`. Give the writer a narrow `post_answer`. Keep one `Message`.
- When: with the next command that posts a message (Thread deletion, #308). Cost M.

### Low

Each low finding is one line here; the ranked list has refs, scenario and fix for each.

- **R3-43.** The module list is written in five places, and `serve.rs`'s list is checked by nothing. `app/desktop/src/modules.ts` also wires each module field by field (#252).
- **R3-44.** The architecture tests check less than the docs say. Nothing stops a cross-module table read or crate dependency, and the window's `STILL` list is keyed by file, not by package (#254, #165).
- **R3-45.** Cross-module names are untyped strings: `git.diff` args from agents, `browser.open`, and the window road's six asks.
- **R3-46.** A fork's images can be swept while the fork still names them.
- **R3-47.** A form's secret is put in memory before its transaction commits.
- **R3-48.** The end of the Agent's own turn is written once; a failed write leaves it running (#312).
- **R3-49.** Two calls with one command ID in flight both run the module's code.
- **R3-50.** Passes never end.
- **R3-51.** The Banda menu's first message is sent again after a refused args update.
- **R3-52.** Seen marks fall off after 500 Threads.
- **R3-53.** Two views stay dead after one failed read: a Visual that says "Not found", and a blank arrangement.
- **R3-54.** A desktop notice can outlive its call.
- **R3-55.** A module with two Watches would collide.
- **R3-56.** Checkpoint refs stay in the Person's repo forever outside a rewind.
- **R3-57.** The outbox and receipts only grow, and a settle that keeps failing holds its key.
- **R3-58.** Every arrangement change logs the whole arrangement.
- **R3-59.** A runaway output sits in one `<pre>`.
- **R3-60.** Terminal history's `since` scans under the PTY's lock.
- **R3-61.** Each subscriber deep-copies a fact and serializes it again.
- **R3-62.** Fork and rewind read ACP evidence outside the adapter.
- **R3-63.** One busy flag and one problem line are shared by twelve commands (#166).
- **R3-64.** `main.ts` answers main's own channels inline and keeps two-window leftovers. The door has no catch.
- **R3-65.** Ghostty's rebuild script still has T3's paths.
- **R3-66.** The settings-file machinery lives in the look crate.
- **R3-67.** Look problems name no key, so they show above the section, not at their row (#176).
- **R3-68.** The kit's stylesheet knows the shell's DOM, and `resizable.tsx` is unused.
- **R3-69.** effect is bundled into main and also packed as a dependency (plausible; not checked in a built app).
- **R3-70.** Rust tests wait by counts and sleeps in four copies, and build the fake agent twice (#259).
- **R3-71.** Generated types are never deleted, and cargo runs without `--locked`.
- **R3-72.** Shared npm pins are repeated across 13 package.json files, and Node's pin is out of Renovate's sight (#253).
- **R3-73.** Three delicate paths have no unit test: `Heard`'s lag branch, the road and `ipc serve`, and Shell's change queue (#162).

## 5. Known, and dropped

- **Fully covered by an open issue:** #160's "Now" text is stale. The rules are now in TS, in Rust, and in a diff layer that reads a command back out of two states (`app/web/src/workspaces/arrange.ts:337-462`). This is #160's work; update the issue text when it is taken.
- **Covered in part,** kept above with the issue named: #165 (R3-22, R3-44), #166 (R3-33, R3-63), #167 (R3-39), #172 (R3-35), #176 (R3-67), #192 (R3-29), #249 (R3-09, R3-30), #252 (R3-43), #253 (R3-72), #254 (R3-44), #258 and #309 (R3-26, R3-27), #259 (R3-70), #295 (R3-06), #305 and #306 (R3-07), #307 (R3-18), #312 (R3-48).
- **Dropped as wrong:** none in substance. Line refs into `passes.rs` and `access.rs` were wrong and are corrected. R3-69 and the CI counts in R3-26 are not checked.

## 6. Refactoring order

**Now: bugs and cheap guards, in six PRs.**

1. **Security.** R3-02 (git safe prefix), and R3-04 plus R3-23's small part (the CLI uses `BANDA_TOKEN`; the skill stops sending Agents to raw CDP). R3-01 needs a small ADR on Space trust; write it now.
2. **Kernel.** R3-05, R3-06 with `Kernel::close` (fixes the cause of #295), R3-07's loop fix, and R3-31.
3. **Agents store.** Put this beside #249. R3-03 and R3-08 (the output table and a bounded view), R3-09, R3-10, R3-30's indexes, and R3-15.
4. **Window.** R3-13 (useLive), then R3-16 and R3-17 through one "hosted Pane" helper, before 8c. Also R3-20, R3-32, R3-34 and R3-36.
5. **Settings.** R3-11, R3-12, and keys.toml in `SCHEMAS`. That last one is a single line: keys.toml problems are dropped from the settings Pane today.
6. **CI.** R3-21, R3-26, R3-28, then R3-71. Then a docs PR for R3-41 and R3-38's test.

**With a feature:**

- #305/#306 → reactions folded into the outbox (R3-07).
- #214 → R3-14, R3-48, R3-50.
- #167 → R3-39.
- #166 → R3-33, R3-63.
- #172 → R3-35.
- #162 and #160 → R3-73's Shell queue tests.
- ADR 0029 step 4 → R3-22, R3-24, R3-45's road asks.
- ADR 0037 step 4 → R3-22's PaneKind declaration, R3-53.
- ADR 0034 step 3 → R3-18's notice (#307), R3-56, the glossary.
- ADR 0033 step 5 → R3-25.
- First run (#314) → R3-19's status, R3-40.
- #241 → R3-29, R3-37's Windows path.
- The next module with an engine part → R3-43, R3-66.
- Thread deletion → R3-42, R3-52, R3-56.

**Later:**

- R3-23's split secret (needs an ADR).
- R3-57, R3-58, R3-60, R3-61 (measure first).
- R3-62 (with a second Harness adapter).
- R3-68.

## 7. What this review did not cover

- **Nothing was run.** No profile, no `EXPLAIN QUERY PLAN` (except one the agents reviewer reports), no e2e, no built AppImage.
- **Adapters.** Codex's adapter and its project-trust behaviour were not read; R3-01 needs that for Codex.
- **macOS and Windows.** PR #241 and the glass on those systems were not read beyond main.
- **Vendored code.** The ghostty WASM and the T3 code were only checked at their seams.
- **Dependencies.** Not audited for CVEs. Renovate's Dashboard (#200, #222) was not read.
- **Accessibility, i18n and UI look** were not reviewed.
- **Off-machine.** The stand (#66), sharing (#314) and remote Spaces (#152) were not reviewed beyond where a finding names them.
