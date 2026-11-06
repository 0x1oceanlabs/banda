---
status: accepted
date: 2026-11-05
---

# Every key is an action's, and the Person, an Agent and an App bind it alike

On 2026-11-04 Roma asked a Thread to put a new terminal on
`Ctrl+Alt+Return`, and the Agent could not. No action opened a terminal
then, so no line of `keys.toml` could name one. The Agent looked for
Banda's actions, found only the modules' (`banda modules`), and read the
window's own in the minified code inside `app.asar`. `banda` was not on
its PATH. And a desktop's skill (Omarchy's) claimed "keybindings", so the
Agent first edited Hyprland's binds. PR #513 added `terminal.new` that
evening, but what stopped the Agent is still there:

- A line of `keys.toml` names an action's id and nothing more, though an
  action already takes args from another module (`WindowApi.run`), as
  `browser.open` takes `address`, `file`, `words` and `project`.
- The window's own actions, some 80, are listed nowhere an Agent reads:
  the whole tiling (ADR 0025, ADR 0065) — columns, Panes, workspaces,
  Groups, the Deck — and the sidebar and the menu. `banda modules` has
  the modules' only, and `banda menu actions` opens the key sheet for the
  Person.
- The keys a Pane reads itself are no action's, so nothing binds them:
  the composer's `Enter`, `Ctrl+Enter`, `Shift+Enter` and `↑ ↓` (ADR
  0031); the browser's `Ctrl+T`, `Ctrl+L`, `Ctrl+W` and the rest (ADR
  0013, decision 5); the letters after `Alt+N`; the terminal's `Ctrl`
  with `+ − 0`.
- `banda settings check` checks how a key is written, not what it runs;
  only the window knows the ids.
- A browser's page gives the window every Alt key, even one `keys.toml`
  frees with `"none"`.

Roma, on 2026-11-05: this is bad for a system that calls itself
hackable. Fix it so it works with the Apps' manifests and with our
tiling, the window's own keys, and so the Person can ask an Agent to
change the keys. ADR 0068 came first and is built: keys are named as
they are pressed, the mod is the Person's, Banda's keys are written by
level and match exactly, and Settings picks the main key. On 2026-11-06
Roma said to finish this one too.

## Decision

1. **Every key Banda or an App answers is an action's.**
   - An action is the window's, as now, or a **scope's**: a kind of Pane
     (`browser`, `terminal`, `launcher`, `thread`), a field (`composer`)
     or a preview over the window (`visual`). Its key works only while
     the focus is there; a Pane's scope is its whole tile.
   - The composer's keys become `agents.composer.send` (`Enter`: what
     `agents.toml` says Enter does while the Agent works),
     `agents.composer.send-other` (`Ctrl+Enter`, ⌘ on a Mac: the other
     of the two), `agents.composer.newline` (`Shift+Enter`),
     `agents.composer.back` and `agents.composer.forward` (`↑ ↓` at the
     field's edge: the messages sent before), and
     `agents.composer.plan` (`Shift+Tab`). The browser's keys become
     `browser.tab-new` and the rest; the launcher's letters,
     `launcher.open` with the kind as its args. Each Pane that zooms has
     its own `zoom-in`, `-out` and `-reset` (`terminal.zoom-in`,
     `agents.thread.zoom-in`, `agents.visual.zoom-in`, `browser.zoom-in`),
     Ctrl or ⌘ with `+ − 0` as ADR 0037 has them; a Thread's details card
     and its find are `agents.thread.details` and `agents.thread.find`.
   - No action holds what is not Banda's to bind: typing; a widget's
     keys as the platform has them (arrows, `Tab`, `Home`, `End`,
     `Escape` and `Enter` in lists, menus, dialogs and a field's
     suggestions); a terminal program's keys; a browser page's own.
   - A narrower scope comes first: the field, then its Pane, then the
     window. A scope may say its keys work with the mod still held too,
     when no key of the window's takes the press: the launcher's letters
     after `Alt+N`, as ADR 0025, decision 4, has them (`modHeld`). A key
     an action declares may give it args, as each letter its kind. Banda's and the Apps' own keys never put a mod key (ADR
     0068) in a scope narrower than the window, so Banda's keys work in
     every Pane, as ADR 0005, decision 10, says; a test holds it. The
     Person may.
   - The window matches every key in one place. A Pane or a field says
     the scope where the focus is, and gives a handler for each of its
     actions by id; it does not read the keys itself. A test fails on a
     Pane that compares a key it does not declare, but for the widget's
     keys above.

2. **The tiling's actions are in a manifest, as an App's are.**
   - The window's own actions, the tiling first, get a manifest:
     `app/web/window.json`, written by the same test that writes the
     modules' (ADR 0022). So the engine knows every action there is, and
     the tiling is bound, listed and checked as an App is, with no case
     of its own. When the window is split into parts with names and bounds of
     their own (the tiling apart from the Threads and the sidebar, a later
     ADR), this manifest is the tiling's.
   - `defineModule` already lists an App's actions, and `window.json`
     copies them for the engine. An action, the window's or an App's,
     adds `scope`, and `args`: a JSON Schema of what it takes, which the
     key sheet, the checks and an Agent read. Keys are written by level
     (ADR 0068, decision 2), in `window.json` too:
     `{ "code": "KeyR", "mod": true }`, not as they read with Alt, so
     the engine makes them real with the mod.
   - A scope is declared with the actions that use it: its id, its name
     for the key sheet, and whether it is a field, where a key that
     types is refused (decision 3).

3. **A line of `keys.toml` can carry args, and each scope has its own
   table.**

   ```toml
   [binds]                      # the window's, everywhere
   "Ctrl+Alt+Return" = "terminal.new"
   "Ctrl+Alt+H" = { action = "browser.open", args = { address = "https://github.com" } }

   [binds.composer]             # while the composer has the focus
   "Return" = "agents.composer.newline"
   "Ctrl+Return" = "agents.composer.send"
   ```

   - A value is an action's id, `"none"`, or `{ action, args }`.
   - `[binds.<scope>]` binds and frees keys in that scope alone. A key
     with neither Alt nor Ctrl may be bound in a scope, not in `[binds]`,
     where it would be typed. In a field's scope a key that types a
     character is refused.
   - The same action may be bound more than once with other args: each
     line is its own row in the key sheet, named by its args.

4. **The look makes the keys in force; the window, the CLI and an Agent
   read the same.**
   - With every manifest's actions, the look reads `keys.toml`: Banda's
     keys with the mod (ADR 0068), then the Person's lines over them,
     scope by scope. It gives each action its keys in force, and Banda's
     own besides, which the reset chord brings back.
   - It names, at their lines, as Problems: an id no App runs (the line
     is kept, as `[bar]` keeps the ids of modules not run, ADR 0064);
     args the action does not take; a key that would be typed; two
     actions on one key in one scope.
   - `banda settings check` checks all of it, with no window open.
   - The window matches the keys in force and no longer rebinds them
     itself. Main gives the window a page's keys only when they are in
     force, so a key freed with `"none"` stays the page's.

5. **`banda keys` binds keys, and an Agent has it as tools.**
   - `banda keys` lists every action: its id, title, scope, keys in
     force, whose they are (Banda's or the Person's) and its args;
     `--json` for one object per line.
   - `banda keys bind <key> <action> [--args JSON] [--scope NAME]`,
     `banda keys free <key> [--scope NAME]` and `banda keys reset <key>`,
     which takes the Person's line out. Each writes `keys.toml` as
     `banda settings set` does, after the checks of decision 4, and
     refuses with their Problem.
   - `banda keys mod <keys>` sets the mod (ADR 0068) and moves the
     Person's lines with it, as Settings does.
   - They are a module of their own, `keys`. Its methods are marked
     `tool`: `keys.list`,
     `keys.bind`, `keys.free`, `keys.reset`, `keys.mod`. An Agent in a
     Thread has them through `banda mcp`, whatever its PATH.
   - The agents module puts the folder that holds `banda` first on each
     session's PATH, so the skill's `banda settings` works too.

6. **The Banda skill owns Banda's keys.**
   - Its description names Banda's keys, shortcuts and keybindings, so a
     Harness picks it, not a desktop's skill, for a key in Banda. A
     desktop's keys are the Person's to name.
   - Its Keys topic: list the actions, bind, check, tell the Person what
     changed and how to undo it. When the desktop may hold the key (ADR
     0068, decision 2), say so, and offer another key or the mod.
   - So the Person asks a Thread, in words: "put the column's full
     width on Alt+M", "a new terminal on Ctrl+Alt+Return", "my Alt is
     AeroSpace's, move Banda to Ctrl+Alt". The Agent finds the action by
     its title in `keys.list`, binds it, and says what changed.

7. **The key sheet lists every scope.**
   - Under the window's actions, a section per scope: Composer, Thread,
     Visual preview, Browser, Launcher, Terminal. Each row shows its keys in force, as ADR 0068,
     decision 4, writes them.
   - "Add a key" (Tab on a row) writes the line into that scope's table;
     a row of the Person's with args shows its args after its title.

## Consequences

- ADR 0005, decision 11: `keys.toml` has scope tables and args. Decision
  2: an action may be a scope's.
- ADR 0022: an action in the manifest has `scope` and `args`; the window,
  with its tiling, has a manifest of its own.
- ADR 0068, decision 2: the look, not the window, makes the keys real.
- ADR 0013, decision 5: a page gives the window only the keys in force.
- ADR 0031: the composer's keys are actions; what Enter does stays
  `agents.toml`'s.
- `GLOSSARY.md`: Action, Scope.
- `Ctrl+Alt+Return` stays `terminal.new`'s, so the hand-on (ADR 0005,
  decision 10) does not give a shell `Alt+Return` there. Moving
  `terminal.new` in `keys.toml` gives it back.
- ADR 0068's five steps came first and are built: keys named as they
  are pressed, the mod, Banda's keys by level and matched exactly, the
  mouse and the pages with the mod, Settings' main key. What is left, one
  PR each:
  1. Manifests: keys by level, `scope` and `args`; `app/web/window.json`
     for the window's own actions; the engine reads them all, and the
     skill's modules topic lists every action.
  2. The look: Banda's keys with the mod, `[binds]` and its scope
     tables, args; the keys in force, Banda's own, and their Problems;
     `banda settings check`. The window takes the keys in force from the
     look, not from its own `rebind`.
  3. The scopes' actions: the composer, the browser, the launcher and
     the terminal move their keys to actions with handlers, narrowest
     scope first; the test against keys no action declares; main gives a
     page's keys in force only.
  4. The `keys` module: `banda keys`, the `keys.*` tools, `banda` on an
     Agent's PATH, the Banda skill's Keys topic. End-to-end tests: the
     fake Agent in a Thread binds `Alt+M` to `column.maximize`, and the
     key widens the column; it binds `Ctrl+Alt+H` to `browser.open` with
     an address, and the key opens it.
  5. The key sheet lists every scope, and Add a key writes into the
     scope's table.
