# The agents module's Panes: for Agents

Read [`README.md`](README.md) first: where each part lives, and how a new
entry or line comes in (ADR 0091). This file holds the rules an Agent
working here keeps.

## A new file goes in its part's folder

- Nothing new at `src/`'s top. The top holds only `ThreadPane.tsx`,
  `index.ts`, `desktop.ts`, `scopes.ts`, `harnesses.ts`, `testing.ts` and
  `architecture.test.ts`.
- Pick the folder by what the file is for:
  - what the Thread shows, knows or does: `thread/`;
  - one kind of the Thread's body: `entries/<kind>.tsx`, and what two
    entries share in `entries/parts/`;
  - a row the timeline adds: `lines/<kind>.tsx`, and what lines share in
    `lines/parts/`;
  - the message box: `composer/`;
  - Questions: `asking/`;
  - a Visual, its Frame and its Pane: `visual/`;
  - the Threads in the sidebar and the bar: `list/`;
  - settings, the module's or a Thread's: `settings/`.
- A test goes beside its file (`x.ts`, `x.test.ts`).
- If no folder fits, say so in the PR. Do not make a new folder or put
  the file at the top.

## Entries and lines

- A view takes its entry or line and its facts as props, and reads the
  rest from `useThreadAround()`. Do not pass a new callback down through
  props; add an act to `ThreadActs` in `thread/context.tsx`, named for
  what it asks.
- `entries/` and `lines/` import no `@banda/ui/pane`, no `ThreadPane`
  and no `thread/Thread`, and read no `window.banda`. A helper an entry
  needs from those goes in `@banda/ui/lib`, as `sleeps` did
  (`lib/later.ts`). `architecture.test.ts` holds this.
- Views draw from `@banda/ui`'s components with the look's values only
  (ADR 0058, ADR 0080). They add no radius, size or colour of their own.

## Names

- Two files in one folder never differ only by case (`thread.ts` beside
  `Thread.tsx`). A Mac cannot tell them apart, and `scripts/check.sh`
  refuses them.
- "Entry" is one thing a Thread shows. "Line" is a timeline row. "Item" is
  `item@1`'s (GLOSSARY).
