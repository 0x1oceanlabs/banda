---
status: accepted
date: 2026-11-02
---

# The bar is quiet, and modules put widgets on its right

ADR 0005 (decision 9) made the bar minimal, as Omarchy's is: the
sidebar's button, which is the Mark, and the workspaces' numbers. "More
comes as icons from modules' manifests, once real use shows they are
needed." Today it holds just that, and, on its right, "Connecting…" while
the engine does not answer and the name of a look file that is wrong.

Roma, on 2026-11-02: "the top bar is empty now, it needs to come alive
somehow." Roma looked at mocks of the bar in three states (quiet, at
work, waiting for the Person) and of four ways to fill its middle, and
decided:

- It stays minimal and stylish, as Omarchy's bar is: text and small
  icons, no boxes.
- Nothing goes on the workspaces' numbers for now.
- The middle stays empty. "A Pane has its own header; I don't see the
  point of repeating it in the bar."
- The widgets on the right are good, and the limits are Banda's own, not
  read from Omarchy's records.
- The numbers stay as niri has them (ADR 0005, decision 7). Roma first
  asked to show 1 to 5 always and 6 to 10 when used, as Omarchy does,
  and kept niri's once it was clear that this needs Hyprland's fixed
  workspaces.

**What Omarchy's bar does.** It is a Quickshell plugin of
`omarchy-shell`. Its layout is `bar.layout` in `~/.config/omarchy/shell.json`:
lists of widget ids for `left`, `center`, `right` and a few more. A
widget is a plugin with a manifest; a widget hides itself when it has
nothing to show; a click opens its popup. Any command that prints
Waybar's JSON can be a widget too. Its `omarchy.agents` widget shows
each AI subscription's limits, which Omarchy's own collectors fetch: for
Claude, Anthropic's OAuth usage endpoint with Claude Code's sign-in; for
Codex, `codex app-server`'s rate limits.

**Decision.**

1. **The bar has three parts, as Omarchy's has: left, middle and right.**
   - Left: the Mark, the sidebar's button, as it is (ADR 0005, decision 9;
     ADR 0008), then the workspaces' numbers as they are: those with
     Panes and the current one, nothing on them.
   - Middle: empty. The focused Pane's header already names what it
     shows.
   - Right: the widgets, then, as now, the engine's connection and the
     look's broken files.

2. **It draws text and small icons, and nothing else.** No boxes or
   pills: a widget is an icon, maybe a number or a word, in the bar's
   muted text; only the one under the pointer gets a background. Colour
   says a state and nothing else: `--warning` when a limit is near,
   `--destructive` when something failed.

3. **A widget is part of a module.** `defineModule` (ADR 0022) gets a
   fourth list, `bar`, beside the Panes, Watches and actions.
   - A widget has an id, `<module>.<name>` as an action's has, and a
     component. The window gives it the engine, the Spaces and the
     focused Space, as it gives a Watch.
   - **It is quiet by default:** it draws nothing while it has nothing
     to say. With nothing going on, the bar is the Mark and the numbers.
   - **What a click does is an action** (ADR 0005, decision 2), named by
     its id. So the key sheet, `keys.toml`, the Banda menu and an Agent
     reach the same thing as the click. A widget with more to say opens
     a popover on a click, and says a line on hover.
   - Its module's rule holds: it shows only while the engine runs its
     module (ADR 0022, decision 5).

4. **Which widgets stand where, and in what order, is the look's
   `[bar]`,** beside its `height`:

   ```toml
   [bar]
   right = ["agents.working", "agents.limits", "terminal.ports"]
   center = []
   ```

   - Banda's defaults list every widget of its own, in decision 5's
     order. A list in `look.toml` replaces Banda's for its part; `[]`
     empties it.
   - The Mark and the numbers are not widgets and stay first on the
     left.
   - The window names an id it does not have, at its line, in the bar,
     as it does for `keys.toml`. `banda look check` can name it once
     the modules' manifests are printed (ADR 0022, step 5).

5. **The first widgets, in the order they come.**
   1. **`agents.working`**: a spinner and how many Threads work now,
      those whose mark is `thinking` or `running`. It counts what the
      agents module's Watch already lists, so it asks the engine for
      nothing. A click shows the sidebar, its Working shelf open
      (ADR 0008).
   2. **`agents.limits`**: how much of each Harness's usage limit is
      spent, Banda's own count.
      - The engine's agents module reads them, on the machine where the
        Harness is signed in: for Claude Code, Anthropic's OAuth usage
        endpoint with Claude Code's own sign-in, and the
        `_claude/rateLimit` updates a turn already brings; for Codex,
        `codex app-server`'s rate limits. It reads them when a turn
        ends and every few minutes while a window listens, and keeps
        the last ones it read, with when.
      - `agents.limits` answers them and an event says when they
        change; it is a tool too (ADR 0019), so an Agent knows how much
        is left.
      - The widget shows the fullest window's share (`✳ 42%`), in
        `--warning` from 80%. Its popover lists every window of every
        Harness: its share, when it resets, and whether the pace runs
        out before then.
      - A Harness that gives no limits shows none; a failed read keeps
        the last ones, and the popover says how old they are and why.
   3. **`terminal.ports`**: the ports that programs started in the
      Space's terminals listen on (`:5173`), as Agents often start a
      dev server unseen. The terminal module finds them from its
      processes; on Linux from `/proc` first. A click opens
      `http://localhost:<port>` in a browser Pane in that Space
      (ADR 0013).
   4. **The branch and its pull request**: the focused Space's branch
      and changes, the PR's checks. They belong to the git modules,
      each a Pane of its own, and come with their ADR.

6. **Not now.**
   - Marks on the workspaces' numbers. ADR 0005, decision 9, had them;
     Roma wants the bar quiet.
   - Workspaces with fixed numbers, as Hyprland's, and with them 1 to 5
     always on the bar.
   - The focused Pane's name in the middle.
   - Widgets from a command that prints Waybar's JSON, as Omarchy's
     custom modules are; dragging widgets along the bar; a widget for
     a Harness's sign-in or update, for Do not disturb (ADR 0011), and
     for the engine's machine once Spaces live on other machines.

**Consequences.**

- **ADR 0005, decision 9, changes:** no marks on the numbers; widgets
  come from the modules now.
- `GLOSSARY.md`: the Bar holds widgets; Widget is a new word.
- The order of work, each step its own PR:
  1. This ADR.
  2. The bar's three parts, `bar` in `defineModule`, `[bar]` in the
     look, and `agents.working`.
  3. `agents.limits`: the engine reads them, then the widget.
  4. `terminal.ports`.
  5. The branch and the pull request, after the git modules' ADR.
