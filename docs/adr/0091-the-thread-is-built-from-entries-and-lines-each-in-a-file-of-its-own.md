---
status: proposed
date: 2026-11-07
---

# The Thread is built from entries and lines, each in a file of its own

Roma asked for the Thread's code to be laid out so that a new element has
an obvious place to go: "расложить все по компонентам что бы когда
появятся новые элементы … было удобно вписывать в структуру которая у нас
уже есть". He asked for it to agree with the new architecture (ADR 0062,
ADR 0087 to ADR 0089) and with the Thread's look (ADR 0058, ADR 0080).
Code is cited as `path:line` from main at `a55312e7`.

**Where it stands.** The Thread Pane is one file of 1,181 lines,
`apps/agents/pane/src/ThreadPane.tsx`, beside 91 other files in one flat
folder. Two `switch`es in it decide what is drawn: `Entry` over the
eight kinds of a Thread's body (`ThreadPane.tsx:939-1043`) and
`Transcript`'s `render` over the six kinds of line the timeline adds
(`ThreadPane.tsx:716-776`). Everything they need comes down as props:
`Transcript` takes more than 20, `Entry` 15, and a new kind adds its own. The
Visual took one more case and an `onOpenVisual` carried through three
components (`ThreadPane.tsx:449`, `:732`, `:1034`). Opening something is
done by calling the Pane's `open(paneOf(…))` (`ThreadPane.tsx:450`), so
the Thread cannot be drawn where there is no Tiling, which a phone in v1
is (ADR 0089 d8).

**Decision.**

1. **The words.** An **entry** is one thing a Thread shows: a message, a
   thought, a call, a plan, a Question, a notice, an Issue, a Visual,
   one for each kind of the Thread's body (`Body.kind`). A **line** is
   what the timeline adds between them: the work line, a fold, the live
   line, a turn that ended, a turn's changes, a proposed plan
   (`timeline.ts:28-40`). "Item" stays `item@1`'s (GLOSSARY); the
   GLOSSARY's Thread says "entries" where it says "items".

2. **One file for each entry, and one table of them.**
   - `entries/<kind>.tsx` draws one kind: `message.tsx`, `thought.tsx`,
     `call.tsx`, `plan.tsx`, `question.tsx`, `notice.tsx`, `issue.tsx`,
     `visual.tsx`.
   - `entries/index.ts` is the table, `{ [K in Body["kind"]]: EntryKind<K> }`.
     A kind with no file does not compile, so a new kind in the contract
     names the one place left to fill.
   - An `EntryKind` says how the entry is drawn and where it goes: its
     `View`, whether it folds into the work line (ADR 0058 d4: thoughts
     and calls do), and, for what waits for the Person, what docks on
     the composer (ADR 0058 d6: a Question's drawer) while its place in
     the Thread keeps one line.
   - A `View` takes the entry and its turn's facts (live, asks, took)
     as props. It is memoised on the entry, so a new entry draws only
     itself (ADR 0088 d9).

3. **One file for each line, and one table of them.** `lines/<kind>.tsx`
   and `lines/index.ts`, as entries have them: `work`, `fold`, `working`,
   `ended`, `changes`, `proposed-plan`. A line that holds entries (work,
   fold) draws them through the entries' table, not through a callback.

4. **What every part needs comes from the Thread's context, not down
   through props.**
   - `useThread()` gives the stable things: the Project, the Thread, the
     `Engine` (`sessionOf(project)` once H5 lands, ADR 0089 d5), the
     image reader, the writers, and the acts.
   - The acts are named for what they ask, not for who does it: open a
     turn's changes, open a Visual, open another Thread, fork, edit,
     retry, snooze, answer. The Thread Pane gives them now with
     `open(paneOf(…))`; when ADR 0087's channels land they become
     `pane.pick` and intents such as `show.diff@1`, and a phone's Thread
     screen answers them by pushing a screen or naming a wide screen
     (ADR 0087 d7, ADR 0089 d8). No entry changes then.
   - The context holds only what does not change while the Thread is
     drawn, so a new event re-renders the entries it touches and no
     other. What changes (the state, the live turn, the clock) goes to
     the part that shows it.

5. **The Thread is one component, and the Pane only holds it.**
   - `thread/Thread.tsx` is the transcript, the dock and the message box.
     It takes the Project, the Thread and its acts. It reads no
     `PaneProps`, no Here and no `window.banda` (ADR 0087 d3, ADR 0089
     d2), and branches on no device (ADR 0089 d7). It obeys the Tile's
     Configure through the Pane (ADR 0088 d4).
   - This is the shape of the catalogue's live component "a Thread with
     its message box" (ADR 0062 d7), so it moves into the catalogue at V2
     without being written again.
   - `ThreadPane.tsx` keeps what is the Pane's: its args, its header and
     menu, find, zoom, its scroll place, and the acts in terms of Panes.
     It is 300 lines or fewer.

6. **Entries are drawn from the catalogue, with the look's values only.**
   - An entry composes `@banda/ui`'s components (Markdown, Message,
     Trace, the block, the bubble, Diff, Console, Kbd) and adds no
     radius, size or colour of its own: ADR 0058 d1's values and ADR
     0080's tokens. A shape two entries share becomes a catalogue
     component, as the one block (ADR 0058 d3) did.
   - A Visual is an entry whose page is drawn in the **Frame** (ADR 0062
     d7): `visual/Frame.tsx` is the sandboxed page with its look, its
     height, its links and its keys (ADR 0037 d4 and d5). The Visual's
     entry, its preview and its Pane use it; an MCP App's `ui://` page in
     a Thread (ADR 0062 d10) will use the same Frame.

7. **The folder says what each part is.** Under `apps/agents/pane/src/`:
   - `thread/`: `Thread.tsx`, `Transcript.tsx`, `context.ts`, and the
     Thread's state and timeline (`thread.ts`, `timeline.ts`) with their
     tests;
   - `entries/` and `lines/` (decisions 2 and 3);
   - `composer/`: the message box, its menus, attachments, drafts and
     slash commands;
   - `asking/`: Questions, their form and the dock;
   - `visual/`: the Frame, the Visual's preview and its Pane;
   - `settings/`, `list/` (the Threads' Source, rows, seen marks) and
     `ThreadPane.tsx`, `index.ts` at the top.

   A test holds it: `entries/` and `lines/` import no `ThreadPane`, no
   `@banda/ui/pane` and no `window.banda`.

8. **How a new element comes in,** written in the folder's README:
   1. its kind in the contract's `Body` (the engine's Rust, generated);
   2. `entries/<kind>.tsx` with its `View`, from catalogue components;
   3. its row in `entries/index.ts`, saying whether it folds or docks;
   4. any act it needs, added to the context once, by what it asks.
   The same for a line, in `lines/`.

**Not done here.** Turning the Thread into a Tree or a catalogue
component (V2), the hosts router (H5), the channels and intents (ADR
0087's steps), and any change to how the Thread looks or behaves.

**Plan.** Each step is its own PR. None changes what the Person sees: each
passes `scripts/check.sh` with the window's tests, and the Thread's
screenshots in `window.spec.ts` stay as they are.

1. The context and `thread/Thread.tsx`; `ThreadPane.tsx` keeps only the
   Pane's part.
2. `entries/` and its table; `Entry`'s `switch` goes.
3. `lines/` and its table; `Transcript`'s `switch` goes.
4. The folders of decision 7, the Frame out of `Visual.tsx`, the border
   test and the README.

**Consequences.**

- A new entry or line is one file and one row, and the compiler names
  the row that is missing.
- The Thread draws where there is no Tiling, so ADR 0089's phone screen
  and ADR 0062's catalogue component start from it.
- ADR 0037's next steps (media in Markdown, Mermaid and maths, a call's
  images) land as entries or catalogue components in their places.

**Changes.**

- **GLOSSARY, Thread:** "It shows items" becomes "It shows entries"; an
  **Entry** and a **Line** are added (decision 1).
- **docs/architecture.md:** the Thread Pane's section names the folders
  and the two tables.
