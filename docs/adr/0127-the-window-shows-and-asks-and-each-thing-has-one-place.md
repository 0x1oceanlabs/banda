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
   _Built_ (WS8, part 1, rule 4): the Actions an empty Banda menu
   offers are the Apps' to say (`Action.usual`), as New Thread and New
   browser, and the menu names none. The test that counts where the
   page's own code names an App reads every folder of the page, the menu
   and Settings too, for every App's words, taken from the Apps'
   `window.json`; its list only falls. Next the Apps declare their
   Settings sections (part 2); what is asked of an App by name waits for
   intents (decision 6).

   _Built_ (WS8, part 2, rule 4): an App declares its section of
   Settings on its module (`Module.settings`): its files, the tables of
   each it shows, and what of them it draws itself, as Agents its
   Harnesses' accounts and the browser its Agents' sites. Settings lists
   the Apps' sections in the modules' order, between the Window's own, so
   Terminal comes before Browser; it names no App's file. What a section
   draws with is Banda UI's (`@banda/ui/settings`, and the row's parts in
   `components/setting-row`), and what it needs of the window is given to
   it: the files' writers, and a Pane over the settings for a sign-in's
   terminal. The agents App's `settings-section` mark went with it.
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
   _Built_ (WS5, part a): Solo is the device's. `flow.solo`
   (`Alt+Shift+M`) and the Flow's menu on the bar turn it on and off in
   the window they are used in, which keeps it with its view, in its own
   storage, and writes no file and no arrangement
   (`client/web/src/tiling/flow.ts`). `flow` in `tiling.toml` says how the
   engine places, `free` or `row`. `solo` stays a value of it: the row,
   and the Person's default, so a device that has not chosen starts in
   Solo. A device has chosen while it shows other than that default; back
   at it, it follows the default again, so the Settings row and `banda
   settings set` still reach it. A pick between free and the row on the
   bar writes the file, as that is how the engine places; from free, Solo
   takes the row with it, as it is a view of the row. Going from solo to
   the row no longer sends a `fill` (_changes ADR 0079_, decision 2): a
   Group `Alt+M` filled stays as the Person left it. The row for a while
   (`Alt+M` in solo) was the window's own state already, and nothing of a
   width as drawn or of the scroll was written. A window sends
   `workspaces.tidy` by itself only while it is in front, and one that
   comes to the front tidies then (`tidiedInFront`,
   `client/web/src/tiling/arrange.ts`). The gate is the page's: the
   engine knows which device a call comes from (`Call::device`), and not
   which one the Person is in front of, so two devices that each have
   their system's focus both tidy still. The arrangement under the
   device's name is part b.
4. **The Tiling's behaviour is one file, `tiling.toml`,** read by the
   engine: the Flow, the widths, and rules that say where a kind of Pane
   opens and how wide. `flow` leaves `agents.toml`, and what is behaviour
   leaves `look.toml`, each under ADR 0069's grace. It is TOML and not
   Lua (Roma, 2026-11-13): the Settings Pane and `banda settings set`
   write a key and keep the file's comments; a rule runs in the engine
   alone, so no client carries an interpreter; and behaviour beyond a rule
   is an App that follows events and runs actions, which decision 2 makes
   possible, so there is one way to extend Banda and not two.
   _Built_ (WS4, part a): the file is the `workspaces` module's, a
   Shared file. It holds `flow` and the rules, each a table named by its
   kind of Pane, `[rule.terminal.terminal]`, with `width` and `opens`
   (`beside`, `below`, `group` or `project`). A table by kind, and not a
   list with a `kind` key, is what `banda settings set` already writes
   key by key: `rule.terminal.terminal.width`. `placing.rs` places by
   the rules for every caller, and a rule gives way where the row would
   refuse the place. `flow` in `agents.toml` is read while `tiling.toml`
   does not say it. The widths of `look.toml`'s `[columns]` stay there
   until the Tiling has its Settings section (part b): the engine places
   by none of them, and moving them moves their rows on the screen.
   _Built_ (WS4, part b; Roma chose the mock's variant A and its answer
   1 on 2026-11-14): Settings has a section, Tiling, after Appearance:
   the Flow, which leaves Agents; the widths; and one row that names
   the rules the file has and opens the file, where a rule is written.
   Five keys of `look.toml`'s `[columns]` are `tiling.toml`'s `[columns]`
   now, under the names they had: `default`, `alone`, `presets`,
   `heights` and `display`. They are the Person's, one for every
   device, as a width is a share of the screen. `look.toml` keeps
   `center`, `min` and `snap`, which are a screen's and a mouse's, and
   their rows stay in Appearance. The five are read in `look.toml`
   while `tiling.toml` does not say them, key by key, the writer writes
   them in the Tiling's file under either name, and `banda settings
   check` tells `look.toml` where each went (ADR 0069 grace). The page
   draws by the two files joined (`columnsOf` in `client/web/src/look.ts`),
   so the engine now has the widths in its own file and still places by
   none of them: a column that names no width is each client's to draw
   (#1708's first point is left for an issue).
   _Built_ (WS4, the leftover, #1735): a list's narrow width is the
   engine's to give. `narrow` is a flag of the kind in its App's
   `window.json`, as `home` and `grouped` are, and a new column for one
   takes the narrowest of `presets` where no rule of the kind says a
   width (`placing::Facts::width`): for the window, an Agent and
   `banda` alike. The page sends no width of its own, and the trace of
   the rules holds its copy to it. Any other column that names no width
   is still each client's to draw, from `default` and `alone`, by what
   stands beside it.
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
