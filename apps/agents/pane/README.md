# The agents module's Panes

The Thread Pane, the sub-agent Pane, the Visual Pane, the Threads' list
for the sidebar, and the module's settings. How the Thread is built is ADR 0091; how it looks
is ADR 0058.

## Where things live

| Folder | What |
|---|---|
| `ThreadPane.tsx` | The Thread as a Pane: its kind, and what it gives the Thread. |
| `thread/` | The Thread: `Thread.tsx` (transcript, dock and message box), `Transcript.tsx`, `context.tsx` (`useThreadAround`), its state (`state.ts`), its timeline (`timeline.ts`), the session, find, the queue, the details card. Its sub-agents (ADR 0103): `subagents.ts` (what a row and a group say), `live-lane.ts` (an opened row's work, read and followed), `SubagentPane.tsx` (one opened beside its Thread, as a Pane in its Group: read only, drawn by `Transcript.tsx`), `beside.ts` (what that Pane's args name and its header, brief and status bar say), `shown-beside.ts` (which row the Thread lights while the Pane shows it), `ask-about.ts` (its status bar's Ask Claude about it, which the Thread's composer takes as a chip), `screens.ts` (where the Thread's Pane is alone, a sub-agent opens over it as a screen: the stack, back, and what Open reads), `SubagentScreen.tsx` (those screens, drawn with `SubagentPane.tsx`'s view); `facts.ts` is how a fact starts or changes an entry, which the Thread's state, a sub-agent's and what the Pane heard of each share. |
| `entries/` | One file per kind of entry, `index.tsx` the table that picks one, `kinds.ts` the timeline's rules for each kind, `types.ts` what a view is given. `parts/` holds what the views share: messages, tool calls, cards, diffs, the proposed plan, a line of work folded (`WorkFold.tsx`), the line a sub-agent's row and their group open by (`RowTrigger.tsx`). `subagent.tsx` is a sub-agent's row, opened in place, and its Open beside, or Open where its Thread's Pane is alone; `messaged.tsx` what was written to a sub-agent after its brief, a row where it was sent and a bubble in its own Pane, drawn as its brief is (`parts/Brief.tsx`). |
| `lines/` | One file per kind of line the timeline adds, `index.tsx` the table and the lines' keys, `types.ts` what a view is given. `parts/` holds the changes card. `subagents.tsx` is the group of sub-agents one message started. |
| `composer/` | The message box: its menus, attachments, drafts, history, slash commands and the model picker. |
| `asking/` | Questions: the drawer that docks on the composer, its form and its keys. |
| `visual/` | `Frame.tsx` (a page apart from Banda, ADR 0062 d7), the Visual in its Thread, its preview, and its Pane. |
| `list/` | The Threads as the sidebar and the bar see them: rows, marks, seen. |
| `settings/` | The module's settings and a Thread's own. |

## A new entry

When a Thread is to show something new:

1. Add its kind to the body in the engine's Rust (`Body`); the contract's
   TypeScript is generated from it. List it in `BODY_KINDS`
   (`sdk/contract/src/agents.ts`), as a window leaves out an entry of a
   kind it does not know (ADR 0103, decision 10), and decide in the
   engine's `handoff.rs` whether it goes to another Harness. Neither
   compiles without it.
2. Add `entries/<kind>.tsx`. Its view takes `EntryProps<"<kind>">`: the
   entry and what the Thread knows of it, as data. It draws from
   `@banda/ui`'s components with the look's values only (ADR 0058, ADR
   0080), and adds no radius, size or colour of its own.
3. Add its row to `VIEWS` in `entries/index.tsx`, and to `ENTRY_KINDS`
   in `entries/kinds.ts`: whether it is work, which folds into the work
   line, and whether it stays out of its turn's fold. Neither table
   compiles without it.
4. If it asks for something (to open a Pane, to answer), add the act to
   `ThreadActs` in `thread/context.tsx` once, named for what it asks, and
   give it in `thread/Thread.tsx`. A view calls it with
   `useThreadAround().acts`.

## A new line

A line is what the timeline adds between entries. Add its kind to `Line`
in `thread/timeline.ts` and where the timeline makes it, then
`lines/<kind>.tsx` taking `LineProps<"<kind>">`, and its row and key in
`lines/index.tsx`. Those do not compile without it. These do, and say
nothing of it until it is there:

- `turnOf` in `thread/timeline.ts`: the turn it belongs to, and
  `staysOut` when it stays out of its turn's fold;
- `room()` in `lines/folded.tsx`: the room it takes in a fold's list,
  when it folds;
- `holds` in `thread/findIn.ts`: the words Find matches in it.

## Borders

`architecture.test.ts` holds them: a Pane imports only the API,
`@banda/ui` and React; `entries/` and `lines/` import no Pane API, no
`ThreadPane` or `thread/Thread`, and read no `window.banda`.
