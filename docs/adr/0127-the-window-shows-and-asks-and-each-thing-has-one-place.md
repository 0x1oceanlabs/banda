---
status: accepted
date: 2026-11-13
---

# The window shows and asks, and each thing has one place

Roma, on 2026-11-13 (translated), after reading how the window works
today: "What hurts is that everything is in several places, and an Agent
breaks the work or the behaviour on updates. The sidebar has just broken
making a new Thread and added a search of its own, though we have one
control panel. Our goal is to put everything in its place: bring all the
logic of behaviour into its logical places, better into one, and add a
config file for the tiling and the behaviour. First the right structure
and architecture, then the look, then the small details, as a drawing
goes: broad strokes first."

It serves principles 2, 3, 4 and 9 of [what we build](../what-we-build.md)
and stories 1 and 2. The map behind it is kept outside the repository
(`~/Banda/artifacts/window-architecture/`).

**Where it stands** (main at `7bbae31e`).

- **A rule in several places.** Where a Pane opens is written in the
  window (`placeFor`, `client/web/src/window/actions.ts:624-646`) and in
  the engine (`platform/workspaces/engine/src/placing.rs:45-103`), and the
  window always names the place (`client/web/src/tiling/arrange.ts:399-402`).
  Who calls the Person is worked out in the page
  (`client/ui/src/status.ts`), in Threads' Pane and again in the engine
  (`apps/agents/engine/src/counts.rs`).
- **Only the window runs an action.** About 230 actions are described in
  words (`client/web/window.json`, each App's `window.json`). An Agent and
  `banda` can list them and bind keys (`platform/keys`), and cannot run
  one. The CLI's one door into the window opens the menu
  (`client/desktop/src/door.ts:1-11`).
- **One arrangement for a machine.** Every window on an engine shares it
  (`platform/workspaces/engine/src/lib.rs:440-458`), and Solo is the
  shared `flow` (`actions.ts:1137-1143`).
- **Behaviour as constants.** The Tiling's rules are code in the window,
  and its few settings are spread over `agents.toml` and `look.toml`.

## Decision

1. **The window has six rules,** in [the window](../window.md): one thing
   in one place; the window shows and asks, the engine decides; everything
   is an action; the window knows no App; a view is the device's, the work
   the machine's, the settings the Person's; behaviour and the look are
   data.
2. **An action runs from anywhere.** `banda act ID` and an Agent's tool
   run any action of the window or of an App, by its id and with its
   arguments, as a key does. The engine checks the id and the arguments
   against what the Apps declare, and asks the device where the Person is
   to run it; with no device there, it says so. An Agent may run any
   action, the Tiling's and the focus's too: Banda does not limit an Agent
   (principle 7). The one thing it does not get is the Person's own
   gesture: what an action does as the Person (`runsAsPerson`, ADR 0083)
   stays the Person's. _Changes ADR 0071_, which gave an Agent the binding
   of a key and not the act.
3. **The arrangement is each device's.** It is kept by the engine of the
   device's own machine, or of the machine that served its page, under the
   device's name (ADR 0124 gives each device one). A phone keeps none in
   its first version. Solo, a width as drawn and the scroll are the view,
   and write nothing. `workspaces.tidy` comes only from the device in
   front. This carries out ADR 0087 decision 10 and ADR 0110 decision 10,
   and words ADR 0101 decision 5 for more than one client on an engine.
4. **The Tiling's behaviour is one file, `tiling.toml`,** read by the
   engine: the Flow, the widths, and rules that say where a kind of Pane
   opens and how wide. `flow` leaves `agents.toml`, and what is behaviour
   leaves `look.toml`, each under ADR 0069's grace. It is TOML and not
   Lua (Roma, 2026-11-13): the Settings Pane and `banda settings set`
   write a key and keep the file's comments; a rule runs in the engine
   alone, so no client carries an interpreter; and behaviour beyond a rule
   is an App that follows events and runs actions, which decision 2 makes
   possible, so there is one way to extend Banda and not two.
5. **The Sidebar is a list.** The Banda menu is the one search, and a
   Thread starts in the New Thread Pane (#1630, which amends ADR 0098).
6. **One name for "an App asks for a Pane":** the intent
   `show.requested@1`, with `from` and `machine`. The engine places what
   it asks for by the same rule as every other caller (ADR 0110,
   decision 4).
7. **The order is structure, then the look, then the details.** How a
   theme travels from its file to every client is structure. How the
   themes look, Banda and macOS first, is worked on with Roma by eye,
   after the structure, in a session of its own.

## Consequences

- An Agent can do in the window whatever its Person can, by the same
  call.
- A second client needs no rule of placement, of order or of who calls.
- The Person's Tiling behaves as their file says, on every device.
- Two clients on one engine each keep their own arrangement.

## Not decided here

- Where the arrangement of a device is kept while its engine is away (the
  story 1 design holds it still "as of"; SE8's cache may draw it).
- How Electron main is split by capability: its plan comes with the slice
  that does it, after story 1's edits to `main.ts` have landed.
- The shape of a rule in `tiling.toml`: the slice that adds the file
  shows it first.
