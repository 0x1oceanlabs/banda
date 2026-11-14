# Now

One page: what is built now, what is not, and what waits for Roma. It
holds no detail of its own; it says where each answer is kept. A PR that
starts, ends or freezes a track changes this page.

## In play

| Track | It builds | It is done when | Its plan |
| --- | --- | --- | --- |
| **1. Story 1** | one Banda on every machine: SE1 to SE13 | the story runs with a Thread at work, moved from the phone | [the roadmap](research/2026-11-08-roadmap-in-slices.md) |
| **2. Story 2** | an Agent writes an App: 2-0 to 2c; then the engine's part of story 1 | Threads is an ordinary App in its own folder | [the roadmap](research/2026-11-08-roadmap-in-slices.md) |
| **3. The window** | the window's structure: WS1 to WS11 | its plan's slices are in | [the window's plan](research/2026-11-13-window-plan.md), [its rules](window.md) |

- The order inside each track, the weeks, and which track owns which file
  where they meet: [the three tracks](research/2026-11-13-three-tracks.md).
- What a track merged last: `git log --grep "track 1" -5`. Every PR names
  its track and its slice.
- Repository work that serves every track, each an issue: borders held by
  the compiler ([#1798](https://github.com/0x1oceanlabs/banda/issues/1798)),
  and one model, not two
  ([#1799](https://github.com/0x1oceanlabs/banda/issues/1799)).

## Not now

Everything else. No session starts it without Roma's word.

- What the tracks put off, what Roma set aside, and parked ideas:
  [the backlog](research/2026-11-13-backlog.md).
- Isolating Agents waits
  ([ADR 0123](adr/0123-the-door-comes-with-the-session-that-follows-the-person-and-isolating-agents-waits.md)).
- A finding that blocks no slice is an issue, not a step.

## Waits for Roma

- **Pull requests:** those with the label
  [`waits-roma`](https://github.com/0x1oceanlabs/banda/pulls?q=is%3Aopen+is%3Apr+label%3Awaits-roma).
  A session that opens a PR for Roma's look, choice or answer gives it the
  label and says in the PR's first line what it waits for:
  `gh pr edit <n> --add-label waits-roma`. It takes the label off once
  Roma has answered.
- **Decisions that hold a slice:**
  [the three tracks' list](research/2026-11-13-three-tracks.md#what-waits-for-roma).
- **What Roma tries each week:**
  [the weeks](research/2026-11-13-three-tracks.md#the-weeks).
