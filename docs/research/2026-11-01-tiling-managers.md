# Tiling window managers and agent workspaces: what Banda's Desk can take

**Date:** 2026-11-01
**For:** Banda workspace design (the Desk of Panes, one Desk per Space)
**Method:** I read primary sources only: the projects' own docs and wikis (where possible the Markdown source in their repos), default config files, source code, READMEs and release notes. I also read three things installed on this machine: Omarchy 4.5.0-rc2 (`/usr/share/omarchy`, identical to the upstream tag `v4.5.0-rc2`), herdr 0.9.5 and herdr-app 0.1.10. I did not use blog write-ups. Two exceptions are marked: news coverage of Superlogical/Rex, used only to cross-check dates.
**Status:** This is research, not a decision. It was written while Banda's audience read "people who do not write code"; on 2026-11-01 Roma set the first audience to enthusiasts and AI-native people, so read "non-developer" below as the later, wider audience. The "What Banda could take" ranking and the key grammar sketch are proposals.

Versions checked: niri v26.04 (2026-04-25) plus `main` as of 2026-10-31; Hyprland v0.57.0 (2026-10-28), wiki `main` (the wiki tracks the latest git commit); Omarchy v4.0.6 stable (2026-10-19) and v4.5.0-rc2 (2026-10-27); herdr TUI 0.9.5; herdr-app 0.1.11 (CHANGELOG, 2026-10-31); PaperWM `develop` README; AeroSpace v0.21.3-Beta; zellij docs (current site); tmux wiki.

---

## 0. The short version

- **niri** puts columns on an endless strip that runs to the right. A new window opens as a new column just right of the focused one. It never shrinks or moves the windows you already have. That rule, together with "the focused window does not move on its own", is the whole reason it feels calm. Classic tilers split the screen again for every new window, so everything gets smaller. niri also has: a zoomed-out Overview with drag and drop, tabbed columns, live-reloaded KDL config that keeps the old config if the new one fails to parse, and a JSON socket with an event stream that sends the full state first.
- **Hyprland** is a dynamic tiler with layouts you can swap per workspace: dwindle (a binary tree, much like Banda's Desk today), master, monocle, and a built-in scrolling layout like niri's. It has special workspaces (scratchpads), groups (tabs), pinned floating windows, a large set of dispatchers, two UNIX sockets (commands and `EVENT>>DATA` events), and in-process C++ plugins. Since 0.55 (May 2026) its config is Lua. You can even register custom layouts in Lua.
- **Omarchy** is DHH's opinionated Arch + Hyprland setup, now at 4.x, maintained under `omacom/omarchy`. It shows best how to make tiling approachable:
  - **One mod, families of meaning.** `Super+key` acts on windows, `Super+Shift+letter` opens or focuses an app, `Super+Ctrl+letter` opens a system panel, and adding `Alt` gives a variant.
  - **Every bind carries a description.** `Super+K` opens a searchable sheet of every bind, and picking a row runs it.
  - **Two menus do almost everything.** `Super+Space` opens the menu and `Super+Alt+Space` opens the app grid.
  - **One `colors.toml` per theme** recolours every app.
  - **Shipped defaults stay read-only.** Your overrides load after them.
- **"herder" is Herdr** (`herdrdev`). It is a terminal workspace manager for coding Agents: a TUI (Rust), plus since October 2026 a **GPUI desktop app** over a separate `herdr-core` server. It is the closest existing thing to Banda:
  - The same structure: Space per repo, tab per task, split panes, an agents sidebar with working/blocked/done/idle.
  - Agents drive the layout over a CLI and socket.
  - The whole UI is files (layouts, keys, JS mods) that the app tells Agents how to edit.
  - Omarchy ships Herdr bindings and theme sync.
- **"superlogic" and "rex" are Superlogical and Rex.** Superlogical is Mitchell Hashimoto's new company (announced 2026-07-29). Rex is its first product, a terminal with persistent sessions, remote connections and "program activity status". It entered public testing on macOS on 2026-10-05. Its multiplexer is not public yet. Confidence: high for the identification, low for any details of the layout model (none are published).
- **For Banda**, the ranked list in section 10 includes a Left-Alt key grammar sketch. The strongest points:
  - One command list that keys, menus, the palette and Agents all call.
  - niri's calm placement rules.
  - Omarchy's families plus a searchable key sheet.
  - Full mouse parity.
  - A per-Desk layout switch (Split vs Strip).
  - A key file with read-only defaults, user overrides and keep-last-good error handling.
- **Left Alt as the mod works, with rules** (section 7a):
  - Act only after an `AltLeft` keydown, decided in Electron's `before-input-event`; `altKey` alone cannot tell left from right, so AltGr stays free.
  - In terminal Panes, leave readline's Alt keys alone (`b f d . u l c t y r p n` …; `Alt+Shift+letter` equals `Alt+letter` there).
  - Remove the Electron menu, so a lone Alt does nothing.
  - Under Omarchy, `Alt+Tab` is the window manager's, not the app's.
  - On macOS, default to Cmd.
- **Two of today's Desk keys clash in a terminal Pane:** `Ctrl+\` (SIGQUIT) and `Ctrl+W` (word erase).

---

## 1. niri (scrollable tiling, `niri-wm/niri`)

The repo moved from `YaLTeR/niri` to the `niri-wm` org in 2026 ([v26.04 notes](https://github.com/niri-wm/niri/releases/tag/v26.04)).

### Spatial model
- "Windows are arranged in columns on an infinite strip going to the right. Opening a new window never causes existing windows to resize." Every monitor has its own strip, and windows never overflow onto the next monitor ([README](https://github.com/niri-wm/niri/blob/main/README.md)).
- **Workspaces are dynamic and stacked vertically, per monitor.** There is always one empty workspace at the bottom. Opening a window there creates a new empty one below it, and empty workspaces in the middle disappear when you leave them. Named workspaces persist even when empty. When a monitor is unplugged, its workspaces move to another monitor and come back when it reconnects ([Workspaces](https://niri-wm.github.io/niri/Workspaces.html)).
- **Column widths.**
  - New columns get `default-column-width` (the default config uses `proportion 0.5`).
  - `Mod+R` cycles `preset-column-widths` (1/3, 1/2, 2/3 by default; fixed pixel widths also work). `Mod+Shift+R` cycles backwards (since 25.08).
  - `Mod+F` maximizes the column, and `Mod+Ctrl+F` expands it into the free space.
  - `center-focused-column` can be `never`, `always` or `on-overflow`, and `always-center-single-column` centres a lone column.

  Source: [Layout](https://niri-wm.github.io/niri/Configuration%3A-Layout.html), [default-config.kdl](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl).
- **Windows stack inside a column.** "Consume" pulls a window into the column and "expel" pushes it out: `Mod+[`/`Mod+]` (`consume-or-expel-window-left/right`), `Mod+,` and `Mod+.` ([default config](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl)).
- **Tabbed columns** (since 25.02): `toggle-column-tabbed-display` (`Mod+W` in the default config) turns a column into tabs with a clickable tab indicator. `default-column-display "tabbed"` makes every new column tabbed ([Tabs](https://niri-wm.github.io/niri/Tabs.html), [Layout](https://niri-wm.github.io/niri/Configuration%3A-Layout.html)).
- **Floating windows** (since 25.01) always sit above the tiles, and the floating layer does not scroll. Dialogs and fixed-size windows float automatically. `Mod+V` toggles a window between floating and tiled, and `Mod+Shift+V` moves focus between the two layers. You can also position a floating window precisely, for example `niri msg action move-floating-window -x 100 -y 200` ([Floating Windows](https://niri-wm.github.io/niri/Floating-Windows.html)).
- **Pinning.** There is no built-in sticky/pinned/always-on-top window yet. The FAQ points to IPC scripts ([FAQ](https://niri-wm.github.io/niri/FAQ.html)).

### What happens when something opens
- The source states the rule plainly. New columns are created and activated "immediately to the right of the active column (in contrast to tabs in Firefox, for example)". When a new column closes before focus has moved, focus goes back to the previous column and its old view offset is restored ([scrolling.rs](https://github.com/niri-wm/niri/blob/main/src/layout/scrolling.rs)).
- **Window rules decide placement and size when a window opens.** They match on `app-id`/`title` regex and other properties, and can set `default-column-width`, `default-window-height`, `open-on-output`, `open-on-workspace`, `open-maximized`, `open-fullscreen`, `open-floating` and `open-focused`. `open-focused false` keeps a newly opened window from stealing focus ([Window Rules](https://niri-wm.github.io/niri/Configuration%3A-Window-Rules.html)).
- **"Open in the current column" is not supported.** The FAQ says it is hard to design well and suggests a script: listen to the event stream, then call `consume-or-expel-window-left` ([FAQ](https://niri-wm.github.io/niri/FAQ.html)).

### Why it feels calm (the problem it solves)
The project's [Design Principles](https://niri-wm.github.io/niri/Development%3A-Design-Principles.html) say it directly:
1. "Opening a new window should not affect the sizes of any existing windows."
2. "The focused window should not move around on its own."
3. "Actions should apply immediately." Input goes to the target even while an animation is still running.
4. Eye candy, when turned off, costs nothing.
5. "Be mindful of invisible state." For example, the view position is remembered per workspace.

Classic tilers (dwindle/i3/master) split the space again for every new window, so each window you open shrinks the others and shifts what you were looking at. niri removes that: things are added *next to* your work, never *into* it.

Evidence limit: I found no primary-source user study of "calm". The claim rests on these stated principles and on the maintainer's own note that he keeps the horizontal view-movement animation "since it helps with spatial awareness" ([v26.04 notes](https://github.com/niri-wm/niri/releases/tag/v26.04)).

### Overview, focus, gestures, mouse
- **Overview** (since 25.05) is a zoomed-out view of all workspaces and windows. You open it with the `toggle-overview` bind, the top-left hot corner, or a four-finger swipe up. Inside it:
  - All keys still work.
  - Mouse: left-drag moves windows, right-drag scrolls, and the wheel switches workspaces without holding Mod.
  - Dragging a window to an edge scrolls the workspaces. Holding the window over a workspace activates it, and you can drop between workspaces to create a new one.

  The default config binds `Mod+O` in v26.04. On `main`, "press and release Mod alone" toggles it, using the new release binds ([Overview](https://niri-wm.github.io/niri/Overview.html), [v26.04 config](https://github.com/niri-wm/niri/blob/v26.04/resources/default-config.kdl), [Key Bindings](https://niri-wm.github.io/niri/Configuration%3A-Key-Bindings.html)).
- **Release binds** ("Since: next release") fire only if nothing else was pressed while the key was held. So a bare `Mod` tap can open the Overview and still leave every `Mod+X` chord free ([Key Bindings](https://niri-wm.github.io/niri/Configuration%3A-Key-Bindings.html)).
- **Grammar rule, stated in the docs:** "if a hotkey switches somewhere, then adding Ctrl will move the focused window or column there." `Mod+Left` focuses the column to the left and `Mod+Ctrl+Left` moves the column left. Workspaces work the same way with `Mod+U/I` and `Mod+Ctrl+U/I`, and monitors add `Shift` ([Getting Started](https://niri-wm.github.io/niri/Getting-Started.html), [default config](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl)).
- **Mouse twins of key actions** ([Gestures](https://niri-wm.github.io/niri/Gestures.html), [default config](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl)):
  - `Mod`+left-drag moves a window and shows an insert hint. Right-clicking while dragging toggles floating.
  - `Mod`+right-drag resizes.
  - Double-clicking a top or bottom resize edge resets the height. Double-clicking a left or right edge toggles full width.
  - `Mod`+middle-drag scrolls the view horizontally, or switches workspaces when dragged vertically.
  - `Mod+wheel` switches workspaces and `Mod+Shift+wheel` scrolls columns. `cooldown-ms` rate-limits wheel binds.
  - Touchpad: a three-finger horizontal swipe scrolls the strip, a three-finger vertical swipe switches workspaces, and four fingers open the Overview.
  - Dragging something against a screen edge scrolls the view.
- **Recent-windows switcher** (`Alt+Tab`, `Mod+Tab`, with previews) since 25.11 ([Recent Windows](https://niri-wm.github.io/niri/Configuration%3A-Recent-Windows.html)).

### Discoverability
- The **"Important Hotkeys" overlay** (`Mod+Shift+/`) opens **once at the first start**; you can turn that off with `hotkey-overlay { skip-at-startup }`. Any bind can add itself to the overlay with a plain-language title (`hotkey-overlay-title="Open a Terminal: alacritty"`) or hide itself with `=null` ([Key Bindings](https://niri-wm.github.io/niri/Configuration%3A-Key-Bindings.html), [FAQ](https://niri-wm.github.io/niri/FAQ.html), [default config](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl)).
- **`Mod` is an abstraction.** It means Super on a TTY and Alt when niri runs nested in a window ([Getting Started](https://niri-wm.github.io/niri/Getting-Started.html)). This is a useful idea for an app that runs inside a window manager.

### Motion
Each animation is configured separately. The defaults are critically damped springs (`damping-ratio=1.0 stiffness=800–1000`) for view movement, window movement, resize and the Overview, and 150 ms ease-out curves for window open and close. A global `off` or `slowdown` setting controls them all, and custom shaders are possible. Resize and view-movement animations are synchronized ([Animations](https://niri-wm.github.io/niri/Configuration%3A-Animations.html), [v26.04 notes](https://github.com/niri-wm/niri/releases/tag/v26.04)).

### Config (KDL), live reload, errors
- The config file is `~/.config/niri/config.kdl`, written in KDL. If it is missing, niri creates it from the embedded default. It live-reloads on save, "including key bindings, output settings … window rules". `niri validate` checks it. `include "file.kdl"` (since 25.11) merges files and watches each of them; `include optional=true` (26.04) tolerates a missing file ([Configuration: Introduction](https://niri-wm.github.io/niri/Configuration%3A-Introduction.html), [Include](https://niri-wm.github.io/niri/Configuration%3A-Include.html)).
- **On a parse error niri keeps running on the old config.** The source shows that `reload_config` returns early and keeps the current config. niri then shows an on-screen notice, "Failed to parse the config file. Please run niri validate to see the errors.", and makes an accessibility announcement. The notice hides on the next successful reload ([niri.rs](https://github.com/niri-wm/niri/blob/main/src/niri.rs), [config_error_notification.rs](https://github.com/niri-wm/niri/blob/main/src/ui/config_error_notification.rs)). `config-notification { disable-failed }` turns the notice off ([Miscellaneous](https://niri-wm.github.io/niri/Configuration%3A-Miscellaneous.html)).

### IPC
- `niri msg [--json] …` talks to a UNIX socket at `$NIRI_SOCKET`. Each request is one line of JSON, and the reply is `Ok`/`Err`.
- **Almost every bindable action can be invoked** as `niri msg action …`.
- The **event stream** "give[s] you the complete current state up-front, then follow[s] up with updates", so a client can never fall out of sync.
- The JSON output is meant to stay stable (fields are added, not renamed), while the human-readable output is explicitly unstable.

Source: [IPC](https://niri-wm.github.io/niri/IPC.html), [default config](https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl).

### Persistence
The docs describe workspace/monitor memory across reconnects, but **no built-in session save/restore across restarts**. I could not find one in the wiki pages I read.

---

## 2. Hyprland (`hyprwm/Hyprland`)

Hyprland 0.55.0 (2026-05-09) made Lua the config language ("config/lua: init lua config manager, use lua if available") ([v0.55.0](https://github.com/hyprwm/Hyprland/releases/tag/v0.55.0)). The wiki now documents Lua (`hl.bind`, `hl.dsp.*`) for the latest git ([Configuring](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/_index.md)). Older blog posts describe the earlier `hyprland.conf` (hyprlang) syntax; `hyprctl reload full-reset` can switch between the two ([hyprctl](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/advanced-configuration/using-hyprctl.md)).

### Layouts (per workspace)
- **Dwindle** is a "BSPWM-like layout, where every window on a workspace is a member of a binary tree". Its "splits are NOT PERMANENT": each split's direction follows the parent's width-to-height ratio unless `preserve_split` is set. `force_split` chooses whether the new window goes left/top, right/bottom, or follows the mouse. `smart_split` picks the split from which triangle of the window the cursor is in ([Dwindle](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/layouts/dwindle-layout.md)). This is the model closest to Banda's current split tree.
- **Master** keeps one or more master windows plus a stack. It has options for where new windows go: `new_status` master/slave/inherit, `new_on_top`, and `new_on_active` before/after ([Master](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/layouts/master-layout.md)).
- **Monocle** makes every window full-size, and you cycle through them ([Monocle](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/layouts/monocle-layout.md)).
- **Scrolling** is now built in: "windows are positioned on an infinitely growing tape" ([Scrolling](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/layouts/scrolling-layout.md)).
  - Options: `column_width` (0.5), `explicit_column_widths` (a cycle list), `focus_fit_method` (center or fit), `follow_focus`, `direction` (right/left/down/up, also per workspace), and `fullscreen_on_one_column`.
  - Layout messages: `consume`, `expel`, `consume_or_expel`, `colresize +conf`, `fit`, `center`, `swapcol`, `promote`, `inhibit_scroll`.
  - A `scrolling_width` window rule sets a starting width per app.
  - Scrolling existed in core by 0.54 (Feb 2026): its release notes fix `algo/scrolling` ([v0.54.0](https://github.com/hyprwm/Hyprland/releases/tag/v0.54.0)). The old **hyprscrolling** plugin left the official plugin repo in May 2026 ("drop unmaintained plugins", [commit](https://github.com/hyprwm/hyprland-plugins/commit/3aa21f2e0ca72412f1b434c3126f8f1fec3c716c); [current list](https://github.com/hyprwm/hyprland-plugins)).
- **Custom layouts in Lua**: `hl.layout.register(name, { recalculate, layout_msg? })`, then `lua:name`. Helpers include `ctx:column`, `grid_cell`, `row` and `split`, and `target:place()` handles gaps and reserved space ([Custom layouts](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/layouts/custom-layouts.md)).

### Workspaces, scratchpads, groups, floating, pinned
- **Special workspaces** are what other window managers call scratchpads. "A workspace that you can toggle on/off on any monitor". You can have many named ones (up to 97 at once): `hl.dsp.workspace.toggle_special("magic")` shows one, and `window.move({ workspace = "special:magic" })` sends a window there ([Dispatchers](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/dispatchers.md)).
- **Groups** are "like i3wm's 'tabbed' container". A group takes one window's space and shows a clickable groupbar. Groups can be locked so new windows cannot enter, and individual windows can be denied ([Dispatchers](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/dispatchers.md)). Groupbar positional dragging came back in 0.57 ([v0.57.0](https://github.com/hyprwm/Hyprland/releases/tag/v0.57.0)).
- **Floating and pinned.** `pin` shows a floating window on every workspace; the docs note that "pinning is ignored for non-floating windows" ([Window Rules](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/rules/window-rules.md)).

### What happens when something opens
**Window rules** use `hl.window_rule({ match = {…}, effect })`. They match on class, title, initial class and title, tag, modal, float, workspace and other fields. **Static effects apply once, at open**: `float`, `monitor`, `workspace`, `size`, `move`, `center`, `pin`, `group`, `no_initial_focus`, `scrolling_width`, and others. Static rules cannot react to a title that changes after the window opens ([Window Rules](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/rules/window-rules.md)). `exec_cmd` can also carry rules for the window it spawns, for example `{ float = true, move = {0,0} }` ([Dispatchers](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/dispatchers.md)).

### Binds and dispatchers grammar
- The form is `hl.bind("SUPER + SHIFT + Q", dispatcher_or_function, { flags })`.
  - Bind flags include `description` (shown by `hyprctl binds`), `repeating`, `locked`, `mouse`, `click`, `submap_universal` and `auto_consuming`. With `auto_consuming`, a Lua bind can return `{ ok = false }` to pass the key on to the app.
  - A modifier on its own can be bound (`Alt_L`), and `code:28` binds by physical keycode.

  Source: [Binds](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/binds/_index.md), [Flags](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/binds/flags.md).
- **Submaps** are modal key sets, such as a "resize mode" with plain arrow keys. The wiki itself warns: "Do not forget a keybind (`escape`…) to reset the keymap… If you get stuck inside a keymap…" ([Submaps](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/binds/submaps.md)).
- **Mouse binds:** `SUPER + mouse:272` with `window.drag()`, and `mouse:273` with `window.resize()`. `drag_threshold` separates a click from a drag on the same button, and `mouse_up`/`mouse_down` bind wheel ticks ([Mouse](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/binds/devices/mouse.md)).
- **Touchpad gestures** follow the finger 1:1: `hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })`. Actions include `move`, `resize`, `float`, `fullscreen`, `close`, `special`, `scroll_move` (for the scrolling tape), `cursor_zoom`, or any Lua function. Gestures can be limited to a modifier ([Gestures](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/binds/gestures.md)).

### Config, live reload, errors
- The config lives at `~/.config/hypr/hyprland.lua`. It "is reloaded when changes to files are detected" (`misc:disable_autoreload` turns that off), and `hyprctl reload` reloads it by hand ([Configuring](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/_index.md), [config options](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/config-options.md)).
- **Errors** ([Configuring → Error behavior](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/_index.md)):
  - A fundamental Lua syntax error makes Hyprland "refuse to reload your config and pop an error", so the old config stays.
  - A runtime error aborts that one file. Each `require`d file is its own scope, so one broken file does not stop the others.
  - A type error pops an error, and execution continues.
  - If the error happens before any bind was registered, Hyprland registers **emergency binds** (`SUPER+Q` terminal, `SUPER+R` launcher, `SUPER+M` exit).
  - Errors appear in an on-screen error bar; see `error_limit`, `error_position` and `suppress_errors` ([config options](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/config-options.md)).

### IPC and plugins
- **Two sockets** live in `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/`:
  - `.socket.sock` takes `hyprctl`-style requests; `hyprctl -j` gives JSON, and `--batch` sends several commands at once.
  - `.socket2.sock` streams `EVENT>>DATA` lines: `openwindow`, `closewindow`, `activewindowv2`, `workspacev2`, `activespecial`, `togglegroup`, `submap`, `urgent`, `configreloaded`, `pin` and more.

  Hyprland handles requests **synchronously**, so a connection left open freezes the compositor until a 5-second timeout ([IPC](https://github.com/hyprwm/hyprland-wiki/blob/main/content/ipc/_index.md), [hyprctl](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/advanced-configuration/using-hyprctl.md)).
- **`hyprctl dispatch '…'` / `hyprctl eval '…'`** run Lua, and there is an interactive Lua REPL (0.56) ([hyprctl](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/advanced-configuration/using-hyprctl.md), [v0.56.0](https://github.com/hyprwm/Hyprland/releases/tag/v0.56.0)).
- **Plugins** are C++ `.so` files that run *inside* the compositor with "(almost) full access". `hyprpm add/enable/reload` manages them, and the wiki warns: "Never trust random `.so` files" ([Using plugins](https://github.com/hyprwm/hyprland-wiki/blob/main/content/hyprland-plugins/using-plugins.md), [Plugin dev](https://github.com/hyprwm/hyprland-wiki/blob/main/content/hyprland-plugins/development/getting-started.md)).

### Motion
`hl.animation({ leaf, speed, bezier|spring, style })` sets animations on a tree (windows, In, Out, Move, fade, workspaces, specialWorkspace, and so on). Unset leaves inherit from their parent, and `speed` is in deciseconds ([Animations](https://github.com/hyprwm/hyprland-wiki/blob/main/content/configuring/core/animations.md)). Springs arrived in 0.55 ([v0.55.0](https://github.com/hyprwm/Hyprland/releases/tag/v0.55.0)).

---

## 3. Omarchy (`omacom/omarchy`, formerly `basecamp/omarchy`)

Omarchy, by DHH, calls itself "The malleable OS for the age of agents" ([omarchy.org](https://omarchy.org)). It is Arch Linux plus Hyprland plus its own shell (`omarchy-shell`, with QML plugins for the bar, menu, notifications and panels). The current stable is v4.0.6 (2026-10-19); v4.5.0-rc2 (2026-10-27) is installed here ([releases](https://github.com/omacom/omarchy/releases)). Omarchy 4 configures Hyprland in Lua. The old [Omarchy 3 manual](https://learn.omacom.io/2/the-omarchy-manual) is "preserved for legacy installations", and its menu keys differ from v4: there, `Super+Space` was the launcher and `Super+Alt+Space` the menu.

### Key grammar (v4.5.0-rc2 source; v4.0.6 is nearly the same)
Every bind goes through `o.bind(keys, description, action)`. The description is the second positional argument (it may be `nil`, as in some user examples). Every shipped key bind fills it in (only the lid-switch events leave it `nil`), and it ends up in the key sheet ([helpers.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/helpers.lua)). The families:

| Family | Meaning | Examples (source) |
|---|---|---|
| `Super + key` | act on windows and workspaces | `W`/`Q` close, `F` fullscreen, `T` float/tile, `J` toggle split, `O` pop out (float + pin), `G` group, `S` scratchpad, `` ` `` Quake console, `M` minimize, `L` cycle layout, `Arrows` focus, `1–0` workspace, `Tab` next workspace, `Space` Omarchy menu, `K` keybindings, `Escape` system menu ([tiling.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/tiling.lua), [utilities.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/utilities.lua)) |
| `Super + Shift + …` | **carry the window along** with arrows and numbers, **open an app** with letters | `Shift+Arrow` swaps windows, `Shift+N` moves the window to workspace N; `Shift+Return` browser, `Shift+F` files, `Shift+N` editor, `Shift+M` music, `Shift+E` email, `Shift+C` calendar, `Shift+A` ChatGPT ([applications.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/applications.lua)) |
| `Super + Ctrl + letter` | **system panels and menus** | `A` audio, `B` bluetooth, `N` network, `D` display, `P` power, `C` capture, `T` theme, `W` background, `E` emoji, `S` share, `L` lock ([utilities.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/utilities.lua)) |
| `+ Alt` | **a variant** of the same action | `Super+Shift+Alt+N` moves the window *silently*; `Super+Shift+Alt+B` opens a private browser; resize steps are `Alt` small and `Ctrl` large; `Super+Alt+L` cycles layouts backwards ([tiling.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/tiling.lua)) |
| `Super + Return` | the main tool | terminal ([applications.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/applications.lua)) |

- **One key per app, launch-or-focus.** App binds use `omarchy-launch-or-focus`: if a matching window exists, it gets focus; if not, the app launches ([omarchy-launch-or-focus](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-launch-or-focus)). So one key always means "take me to X".
- **Physical keys for digits and symbols.** Workspaces bind `code:10…19` and resize binds `code:20/21` (the minus and equals keys), so the binds work on any keyboard layout. The key sheet then names each key the way the active layout prints it; the source mentions JIS ([tiling.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/tiling.lua), [omarchy-menu-keybindings](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-menu-keybindings)).
- **Universal clipboard.** `Super+C/V/X/A` are translated to `Ctrl+C/V/X/A` in normal apps and `Ctrl+Shift+C/V` in terminals ([clipboard.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/clipboard.lua)). The manual says this lets Mac and Windows muscle memory "transfer to one key: Super" ([Coming from Mac or Windows](https://omarchy.org/manual/coming-from-mac-or-windows/)). **This means `Super+C/V/X/A` are never free for an app running under Omarchy.**
- **Terminal multiplexer prefix.** Omarchy's tmux and Herdr configs use `Ctrl+Space` as the prefix. Hyprland has a pass-through bind that drops the input method so the next key reaches the multiplexer ([tmux.conf](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/config/tmux/tmux.conf), [herdr config.toml](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/config/herdr/config.toml), [input-method.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/input-method.lua)). Inside those tools Omarchy uses **Alt for tabs and workspaces** (`alt+left/right` previous/next tab, `alt+up/down` workspace, `alt+1..9` tab) and **Ctrl+Alt+Arrows for pane focus** ([herdr config.toml](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/config/herdr/config.toml)).

### Making it learnable: the key sheet and menus
- **`Super+K` is the "only hotkey you actually have to memorize"** ([Coming from Mac or Windows](https://omarchy.org/manual/coming-from-mac-or-windows/), [Hotkeys](https://omarchy.org/manual/hotkeys/)). It opens a searchable list of every bind with its description, built from Hyprland's bind table plus a cache derived from the Lua source. **Picking a row runs that bind**, so the key sheet doubles as a command palette ([omarchy-menu-keybindings](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-menu-keybindings)). `Super+Alt+K` shows the tmux keys and `Super+Ctrl+K` the Herdr keys.
- **`Super+Space` opens the Omarchy menu** and **`Super+Alt+Space` the app grid**. "These two commands allow you to do just about everything" (manual wording for v3, where the two keys were swapped; v4 binds `Space` = menu, `Alt+Space` = apps, per [Navigation](https://omarchy.org/manual/navigation/) and [utilities.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/utilities.lua)).
  - The menu is one JSONC tree: Apps, Learn, Appearance, Trigger, Setup, Install, Remove, Update, About, System.
  - Each entry is an `id → {icon, label, action | submenu, when, checked, disabled, aliases}`. Every route can be opened directly from a key or the shell (`omarchy menu summon appearance.theme`). Learn → Keybindings opens the same key sheet ([omarchy-menu.jsonc](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/omarchy/omarchy-menu.jsonc), [omarchy-menu](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-menu)).
- **Mouse.** `Super`+left-drag moves and `Super`+right-drag resizes. The top bar shows each workspace's layout, and clicking that mark cycles it. Floating workspaces have themed titlebars with minimize, maximize and close buttons, plus a dock ([Navigation](https://omarchy.org/manual/navigation/)).

### Tiling made approachable
- **Dwindle is the default.** `Super+L` cycles the *current workspace* through dwindle → scrolling → floating, and the choice persists across restarts ([Navigation](https://omarchy.org/manual/navigation/), [omarchy-hyprland-workspace-layout-toggle](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-hyprland-workspace-layout-toggle), [workspace-layouts.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/workspace-layouts.lua)). The layout switch is a visible per-workspace option, not a config edit.
- **Overlays.** The scratchpad (`Super+S`) is a full-size overlay workspace. The Quake console (`` Super+` ``) is half height. A popped window (`Super+O`) floats, stays pinned and follows you, which suits video. Groups (`Super+G`) make tabs. All from [Navigation](https://omarchy.org/manual/navigation/).
- **Tone.** The manual is frank: "It's not trying to be as familiar as possible… Embrace the Linux-ness" ([manual](https://omarchy.org/manual/)). Omarchy is *approachable for keyboard people*, not built for non-developers.

### Theme system
- **One `colors.toml` per theme.** It holds semantic tokens (`accent`, `background`/`dark_`/`darker_`/`lighter_background`, `foreground` tiers, `selection`, `muted`, ANSI colours and bright variants) and `mode = "light"|"dark"` ([tokyo-night/colors.toml](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/themes/tokyo-night/colors.toml)).
- **Templates per app.** On every switch, `.tpl` templates are filled in for each app: alacritty, foot, ghostty, kitty, btop, chromium, Hyprland, Neovim, Helix, VS Code, Obsidian, the shell, Claude and T3 Code. The apps are then retinted in parallel ([themed/](https://github.com/omacom/omarchy/tree/v4.5.0-rc2/default/themed), [omarchy-theme-set](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-theme-set), [Making your own theme](https://omarchy.org/manual/making-your-own-theme/)).
- **Your own templates override the built-in ones.** Themes installed from git have their code-running files (`.lua`, terminal configs, `vscode.json`) stripped ([omarchy-theme-set](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-theme-set), [Making your own theme](https://omarchy.org/manual/making-your-own-theme/)).
- **Switching.** `Super+Ctrl+T` or Menu → Appearance → Theme ([Themes](https://omarchy.org/manual/themes/)). The theme can also be mirrored to your Herdr machines over SSH ([omarchy-theme-set-herdr-machines](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-theme-set-herdr-machines)).

### How people override defaults without editing shipped files
- **The layout on disk.** Shipped defaults live read-only in `/usr/share/omarchy/default/…`. The user's `~/.config/hypr/hyprland.lua` loads them with `require("default.hypr.omarchy")`, then loads the person's own `hypr.monitors`, `hypr.input`, `hypr.bindings`, `hypr.looknfeel` and `hypr.autostart`. The comment explains: "loaded after Omarchy's defaults so package updates can improve the defaults without rewriting your ~/.config/hypr files" ([config/hypr/hyprland.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/config/hypr/hyprland.lua)).
- **The override verbs** ([config/hypr/bindings.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/config/hypr/bindings.lua)):
  - `o.bind` adds a bind.
  - `o.rebind` replaces one.
  - `hl.unbind` removes one.
  - `omarchy_default_bindings = false` drops all defaults, and `omarchy_preinstalled_bindings = false` drops only the app shortcuts.
  - `omarchy menu keybindings --print` lists what is bound now.
- **Starting over.** `omarchy-refresh-config hypr/hyprland.lua` copies a shipped template back and keeps a backup of yours ([omarchy-refresh-config](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/bin/omarchy-refresh-config)).

---

## 4. "herder", "superlogic", "rex": identification

### Herdr ("herder") — confirmed
- **What it is.** `herdrdev/herdr`: "Herdr terminal workspace manager for AI coding agents" (Apache-2.0, Rust). Its README calls it "the runtime your coding agents live on". It runs Claude Code, Codex, Cursor, OpenCode and other agents unmodified ([README](https://github.com/herdrdev/herdr); local package description, herdr 0.9.5).
- **Model.**
  - "A session is a persistent Herdr server namespace."
  - "A workspace is the top-level project container" (one per repo, task or investigation).
  - "A tab is a layout inside a workspace."
  - "A pane is a real terminal", split right or down.
  - **Agent states:** `blocked` (needs input, approval or a decision), `working`, `done` (finished and not yet seen), `idle` (finished and seen), `unknown`. A workspace rolls these up into a single status.
  - "Herdr is mouse-native… keyboard bindings are an optional layer."

  Source: [Concepts](https://herdr.dev/tui/docs/concepts/).
- **Agents drive it.**
  - The CLI and newline-delimited JSON socket offer `workspace.create`, `tab.create`, `pane.split`, `pane.swap/move/zoom`, `agent.start`, `agent.prompt` (with a wait), and `agent.wait`, which is "server-owned and event-driven".
  - Event subscriptions include `pane.created`, `pane.focused`, `pane.agent_status_changed`, `tab.*` and more.
  - "JSON API clients should ignore unknown fields."

  Source: [Socket API](https://herdr.dev/tui/docs/socket-api/).
- **Built-in agent skill.** `herdr --skill` prints a skill that tells agents:
  - Default to a sibling pane in the current tab.
  - "Split a wide pane to the right and a narrow or tall pane down. Avoid repeated same-direction splits."
  - Keep the user's focus: `pane split --current --direction right --no-focus`.
  - Never answer an approval dialog without asking the person.

  Source: local herdr 0.9.5, `herdr --skill`. This is direct evidence for the "Agents arrange Panes" design.
- **Persistence.** On restart Herdr restores "workspaces, tabs, panes, cwd, layout, and focus". It resumes native agent sessions for supported agents (Claude Code, Codex, OpenCode and others). It never revives arbitrary processes: those come back as fresh shells in the saved folder. Pane history replay is opt-in ([Session state](https://herdr.dev/tui/docs/session-state/)).
- **Desktop app (herdr-app, new in October 2026).**
  - **Tech.** Rust on **GPUI** (`gpui-pre` 0.3.8 and vendored `gpui-kit`). Panels are JavaScript "mods" running on QuickJS that describe GPUI elements; there is no DOM ([Cargo.toml](https://github.com/herdrdev/herdr-app/blob/master/Cargo.toml), [defaults/AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)).
  - **Split.** "The window arranges terminals. The core runs them." Agents keep running when the window closes ([README](https://github.com/herdrdev/herdr-app)).
  - **Model.** A **space** per repo on one machine, **tabs** per task, panes split right and down. A pane can also be a mod (a markdown viewer, a board, a git panel) and splits, zooms and saves like any other pane. Floating blocks can be drawers that peek from an edge. The agents sidebar rolls status up as blocked > done > working > idle ([AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md), [herdr.dev](https://herdr.dev/)).
  - **The whole UI is files** in `~/.config/herdr-app`, and the app writes an `AGENTS.md` there "on every start" so a coding agent can change the layout, keys and theme on request. The files are `layouts/*.json` (a tree of `row`/`column`/`stack`/`block` nodes), `keys.json`, `settings.json` and `mods/`. Invalid files are skipped: "the app keeps the last good version and writes why to `<name>.error`". **`ctrl-alt-shift-escape` always resets** the layout and keys, and "Nothing can rebind it". Edited shipped files are moved aside as `-edited` copies and the shipped version is restored ([AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)).
  - **One command list.** "Commands: The one way to change anything; keys, mods (`run(name, args)`), menus and you use the same list." For example: `herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "…"`, `herdr-app do pane.split:right`, `herdr-app ls`, `herdr-app status`. Agents "never get a dialog": a missing argument comes back as an error ([AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md)).
  - **Default keys.**
    - Linux: Alt navigates (`alt-arrows`/`hjkl` go to a pane, `alt-shift-hjkl` swap, `alt-1..9` space, `alt-up/down` next/previous agent). Ctrl+Shift changes structure (`ctrl-shift-o` split right, `ctrl-shift-e` split down, `ctrl-shift-x` close pane, `ctrl-shift-z` zoom, `ctrl-shift-p` palette, `ctrl-shift-/` help).
    - macOS: Cmd for structure (`cmd-d`/`cmd-shift-d` split), and `cmd-alt-arrows` to go to a pane.
    - `keys.json` has sections `global`, `layout:<name>`, `terminal` and `mod:<name>`. The action `"terminal"` hands a key to the program. The docs tell agents not to bind plain Ctrl+letters that programs rely on.

    Source: [keys.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.json), [keys.macos.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/keys.macos.json), [AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md).
- **Tie-in with Omarchy.** Omarchy ships a Herdr config, `Super+Ctrl+Return` (Herdr), `Super+Ctrl+K` (Herdr keys) and theme sync ([applications.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/applications.lua), [utilities.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/utilities.lua)).

### Superlogical ("superlogic") and Rex ("rex") — confirmed with limits
- **Superlogical** is a company founded by Mitchell Hashimoto (Ghostty, HashiCorp) with Jack Pearkes, Alasdair Monk and Hector Simpson. It is building "a multiplexer for all work" and will "begin with a terminal multiplexer". The site says terminals "connect developers, agents, tools, and infrastructure", and that a session should be "driven by software while remaining visible and controllable by people" ([superlogical.com](https://www.superlogical.com)). Hashimoto's post of **2026-07-29**: "Superlogical will begin by shipping a terminal multiplexer… build on libghostty" ([mitchellh.com/writing/superlogical](https://mitchellh.com/writing/superlogical)).
- **Rex** "is a drop-in replacement for whichever terminal you use today" with "persistent sessions, performant and responsive remote connections, program activity status". The screenshot shows Codex, lazygit and a game in three split panes. The macOS app hosts its own Rex server and can connect to others. Public testing began on macOS on **2026-10-05**; servers run on Linux and Windows, and other clients are not ready yet. The multiplexer beta is "not yet available" ([updates/public-testing-beginning](https://www.superlogical.com/updates/public-testing-beginning)). Secondary news coverage (e.g. [devclass](https://www.devclass.com/devops/2026/08/01/dev-who-gave-hashicorp-its-name-returns-with-a-faster-terminal-multiplexer/5282025)) matches the dates. I took no layout facts from it.
- **Evidence limits.** Superlogical publishes no docs on panes, layout or keys. What matters for Banda is the *direction*: durable sessions, an activity status per program, and one session visible to people and drivable by software.

---

## 5. Others, only where they add something

- **PaperWM** (GNOME extension; the original scrollable tiling) ([README](https://github.com/paperwm/PaperWM/blob/develop/README.md)):
  - **Placement.** New windows tile "to the right of the active window, taking up as much height as possible". The insertion position can be switched between right, left, start and end from a *top-bar button*.
  - **Navigation.** A **minimap** shows while `Super` is held, focus commits when `Super` is released, and `Escape` aborts the move.
  - **Position bar.** A coloured **window position bar** in the top bar shows where you are on the strip.
  - **Focus modes.** Default, center and edge, toggled from a top-bar button.
  - **Scratch layer.** "An escape hatch to a familiar floating layout… the kitchen sink".
  - **Mouse.** "Most functionality is available using a mouse."
- **AeroSpace** (macOS, i3-like) ([README](https://github.com/nikitabobko/AeroSpace/blob/main/README.md), [guide](https://nikitabobko.github.io/AeroSpace/guide)):
  - **Workspaces without macOS Spaces or disabling SIP.** Windows of inactive workspaces are moved outside the visible area of the screen.
  - **Tree.** Containers with one child are flattened ("normalization"). The tiles and accordion layouts work as tabs.
  - **Rules and hooks.** `on-window-detected` callbacks decide where a window opens (the first matching `if` runs its `run`). `exec-on-workspace-change` runs a hook. Binding modes exist.
  - **Config.** TOML with optional `auto-reload-config`. AeroSpace is still "Public Beta".
  - **Lesson.** You can emulate a workspace model inside a host that does not offer one.
- **tmux** ([Getting Started](https://github.com/tmux/tmux/wiki/Getting-Started)):
  - **Persistence.** Detaching leaves the session running in a server, and the server exits when nothing is left. The wiki does not describe restoring after a reboot (third-party plugins do that).
  - **Prefix.** The `C-b` prefix waits for a second key.
  - **Built-in help.** `C-b ?` lists binds, and "every default tmux key binding has a short description". `choose-tree` picks sessions, windows and panes from a tree. Mouse support is opt-in.
- **zellij**:
  - **Layout files.** Layouts are KDL text files of panes and tabs, and can be loaded at start, inside a session, from a URL (commands wait for confirmation), or at runtime with `override-layout` ([Layouts](https://zellij.dev/documentation/layouts.html)).
  - **Swap layouts.** These **re-arrange panes automatically by count**: each node carries `max_panes`/`min_panes`/`exact_panes`, and `Alt+[`/`Alt+]` cycles them by hand. Floating panes have their own swap layouts ([Swap layouts](https://zellij.dev/documentation/swap-layouts.html)).
  - **Session resurrection.** The session is serialized every second into a human-readable layout. Restored commands **wait for `ENTER`** unless `--force-run-commands` is given ([Session resurrection](https://zellij.dev/documentation/session-resurrection.html)).
  - **Plugins** are WebAssembly/WASI, "a first class citizen in the workspace, just like a terminal pane", and zellij builds its own UI from plugins ([Plugins](https://zellij.dev/documentation/plugins.html)). Plugins must **request permissions** (`ReadApplicationState`, `ChangeApplicationState`, `RunCommands`, `OpenTerminalsOrPlugins`, `ReadPaneContents`, …) ([Permissions](https://zellij.dev/documentation/plugin-api-permissions.html)).

---

## 6. Keys and mouse: how each pairs a key action with a pointer action

| Action | niri key | niri pointer | Hyprland / Omarchy key | Hyprland / Omarchy pointer | Herdr app |
|---|---|---|---|---|---|
| Focus a neighbour | `Mod+Arrows` / `HJKL` | click; `Mod+Shift+wheel`; 3-finger horizontal swipe scrolls the strip | `Super+Arrows` | click; focus follows the mouse (Hyprland option) | `alt-arrows`; click |
| Move / swap | `Mod+Ctrl+Arrows` (Ctrl = "carry it along") | `Mod`+left-drag with insert hint | `Super+Shift+Arrows` swap | `Super`+left-drag (`window.drag()`) | `alt-shift-hjkl`; drag the top-centre grip (centre drop swaps, edge drop places beside) |
| Resize | `Mod+R` presets, `Mod+-/=` | `Mod`+right-drag; double-click an edge resets the height or toggles full width | `Super+-/=` (physical codes; `Alt` small, `Ctrl` large steps) | `Super`+right-drag; drag borders | drag the split border |
| Tabs | `Mod+W` tabbed column | click the tab indicator | `Super+G` group, `Super+Ctrl+Left/Right` | click or drag the groupbar; `Super+Alt+wheel` | tabs per space; click |
| Workspaces | `Mod+U/I`, `Mod+1..9` | `Mod+wheel`; 3-finger vertical swipe; `Mod`+middle-drag | `Super+1..0`, `Super+Tab` | `Super+wheel`; workspace swipe gesture | `alt-1..9` spaces; sidebar |
| Overview | `Mod+O` (v26.04), Mod tap (`main`) | top-left hot corner; 4-finger swipe; drag between workspaces | none in core | none | none |
| Float / scratch | `Mod+V` | right-click while dragging | `Super+T`, `Super+S`, `Super+O` | Omarchy floating workspace: titlebar buttons, dock | floating blocks and drawers |
| Help | `Mod+Shift+/` overlay (shown at the first start) | none | `Super+K` searchable sheet that runs binds | none | `ctrl-shift-/`, `ctrl-shift-p` palette |

Sources: sections 1–4.

**Pattern:** the pointer twin usually *reuses the same modifier* (Mod+drag, Mod+wheel). That is quick for power users and invisible to newcomers. Only Herdr and Omarchy's floating workspaces add *visible* handles (grips, titlebar buttons, a clickable layout mark).

---

## 7. The mod-key problem for an app inside a Super-owning window manager (owner's choice: Left Alt)

How apps that live inside a window manager pick their own keys. Sources are tagged `[Zx]`, `[Vx]` and so on and listed in section 13. All were fetched on 2026-11-01 from the projects' `main`/`dev` heads unless a tag is named.

| App | Own mod: Linux / macOS | Split / focus / close defaults | Keeping keys away from a shell or a page |
|---|---|---|---|
| Zed | Ctrl, plus `Ctrl+K` chords / Cmd, plus `Cmd+K` | `Ctrl+\` split right (Editor), `Ctrl+K` then an arrow to split, `Ctrl+K Ctrl+Arrow` focus, `Ctrl+W` close [Z1][Z2] | A `Terminal` keymap context sends `Ctrl+W/B/C/E/O/Q/R` to the shell. Inside a terminal, close is `Ctrl+Shift+W` and split is `Ctrl+Shift+5` [Z1][Z3] |
| VS Code | Ctrl, plus `Ctrl+K` chords / Cmd | Editor: `Ctrl+\`, `Ctrl+1/2/3`, `Ctrl+W` [V1][V2]. Terminal: `Ctrl+Shift+5` split, and `Alt+←/→` focus, **only when a split terminal exists** [V3] | `commandsToSkipShell` lists commands that never reach the shell. `sendKeybindingsToShell` flips the default the other way. Chords always skip the shell. Alt menu mnemonics are off inside the terminal [V4] |
| Warp | Ctrl+Shift / Cmd | `Ctrl+Shift+D` right, `Ctrl+Shift+E` down, `Ctrl+Alt+Arrows` focus, `Ctrl+Shift+W` close; right-click a pane to split in any direction [W1] | The shortcut editor marks conflicts with an orange border [W2] |
| Ghostty | Ctrl+Shift / Cmd | `Ctrl+Shift+O` right, `Ctrl+Shift+E` down, `Ctrl+Alt+Arrows` focus, `Ctrl+Shift+W` close [G1] | `performable:` binds take the key only when their action can actually run [G1] |
| kitty, WezTerm | `kitty_mod` = Ctrl+Shift [K1]; WezTerm uses SUPER, with Ctrl+Shift twins [WE1] | `Ctrl+Shift+Enter` new pane (kitty); `Ctrl+Shift+Alt+"/%` split (WezTerm) | – |
| zellij 0.45.1 | Ctrl modes plus Alt shortcuts | `Ctrl+P` (pane mode), then `r`/`d`/`x`; `Alt+Arrows` focus; `Alt+N` new pane [ZJ1] | **"Unlock-First (non-colliding)" preset** (0.41.0, 2024-11): starts locked, so every key goes to the program until `Ctrl+G`. A first-run wizard offers it [ZJ2][ZJ3] |
| tmux 3.8 | prefix `Ctrl+B` | prefix then `%` / `"` to split, arrows to focus, `x` to close (asks first) [T1][T2] | prefix twice sends a literal `Ctrl+B` to the program [T1] |
| Zen (Firefox) | Ctrl / Cmd | `Ctrl+Alt+V/H/G/U` for split views; `Alt+digit` switches Spaces on Linux [ZN1] | Firefox keys marked `reserved="true"` (new window/tab, close tab/window, quit) always stay with the browser; every other key follows a per-site permission [FF1][FF2] |
| Arc (macOS/Windows) | Ctrl / Cmd | `Ctrl+Shift+=` adds a split; `Alt+←/→` back/forward (Windows) [A1] | No published rule |
| Obsidian | Ctrl / Cmd | split from a tab's right-click menu or by dragging; no default split hotkey [O1] | – |

**What this shows.**
- On Linux, every terminal emulator uses **Ctrl+Shift** for its own actions [W1][G1][K1][WE1], which leaves plain `Ctrl+letter` to programs. Editors **scope keys to the focused pane's kind** [Z1][V3].
- Some apps make binds conditional: VS Code's `Alt+←` focuses only when a split exists, and Ghostty has `performable` [V3][G1].
- zellij offers a "locked" preset as a switch at first run [ZJ2][ZJ3].
- No app documents a clash with a Super-owning window manager. Some Linux defaults do use Super and would collide (WezTerm's SUPER rows, Ghostty's `Ctrl+Super+[`/`]`) [WE1][G1].

### 7a. Left Alt as Banda's mod: what it collides with, and the rules

**Collisions**
- **The shell in a terminal Pane.**
  - Readline defaults: `M-f`/`M-b` move by word, `M-d` and `M-DEL` kill a word, `M-.`/`M-_` insert the last argument, `M-0…9`/`M--` give a numeric argument, and `M-u/l/c/t/y/r/p/n/</>/?/*/#` are bound too.
  - "The left ALT … is generally set to work as a Meta key", and typing ESC then k equals Meta-k [RL]. `Alt+Shift+letter` runs the lowercase binding (section 10).
  - xterm's `metaSendsEscape` decides whether Meta is sent as an ESC prefix [X1].
- **Programs running inside a terminal Pane.** zellij's own defaults are Alt-based (`Alt+Arrows/hjkl`, `Alt+N`, `Alt+F`, `Alt+[`/`]`) [ZJ1]. So are Omarchy's tmux and Herdr configs (section 3).
- **AltGr / Right Alt on European layouts.**
  - `KeyboardEvent.code` tells `AltLeft` from `AltRight`. The spec notes that AltRight is labelled AltGr and produces `key` "Alt" in some locales and "AltGraph" in others [UC][UK].
  - **`altKey` is true for either Alt** [UE]. An app that wants Left Alt only must remember which Alt keydown it saw, by its `code`.
  - On Windows, AltGr arrives as Ctrl+Alt: `getModifierState("AltGraph")` and "Control" are both true [M2]. Chromium has reported `AltGraph` for right Alt on AltGr layouts since 2017 [CR1].
  - Chromium's Linux XKB code maps AltGr to Mod5 [CR2]. Wayland behaviour was **not verified** at runtime.
- **Electron's menu bar.** With `autoHideMenuBar`, "the menu bar will only show when users press the single `Alt` key" (Linux, Windows) [EL1]. `Menu.setApplicationMenu(null)` removes the menu [EL2].
- **Web pages in a browser Pane.**
  - Blink's access-key modifier is **Alt on non-Mac** and Ctrl+Option on Mac [BL]. Firefox uses Alt+Shift [M3]. accesskey is only a hint [HTML].
  - Chrome habits on Windows/Linux: `Alt+←/→` back/forward, `Alt+Home`, `Alt+F`/`Alt+E` menu, `Alt+D` address bar, `Shift+Alt+N` split view [CH].
- **macOS.** Option, alone or with Shift, types special characters, and dead keys add accents [AP]. Terminals only *opt in* to Option-as-Alt:
  - VS Code `macOptionIsMeta`, default false [V9]
  - Zed `option_as_meta`, default false [Z4]
  - Ghostty `macos-option-as-alt`, default true only on US layouts, settable to `left`/`right` [G1]
  - kitty `macos_option_as_alt`, settable to left, right or both [K1]

**Rules for Banda (Left Alt)**
1. **Decide Alt chords in the Electron main process** with `before-input-event`. It fires before the page's keydown, carries `code`, and `preventDefault()` keeps the key from the page [EL3]. Act only when the Alt held down was the one whose keydown had `code == "AltLeft"`. Never treat AltRight/AltGraph as the mod [UC][UE].
2. **Bind by physical key** (`code`), so the binds work on Russian, German and Polish layouts. Show the key in the sheet as the active layout prints it (Omarchy does this, section 3).
3. **Terminal Panes keep readline's Alt keys** (`b f d . _ Backspace u l c t y r p n …` and their Shift forms). The Desk takes only keys readline leaves free (section 10), the way VS Code takes `Alt+←/→` [RL][V3].
4. **A per-Pane "keys to the program" lock.** It is a visible header toggle, and the person can make it the default for terminal Panes (zellij unlock-first as a switch). It serves people who run zellij, tmux or Emacs inside a Pane [ZJ1][ZJ2].
5. **No auto-hiding menu bar.** Remove the app menu, so a lone Alt press does nothing [EL1][EL2]. Only then is a niri-style "tap Alt alone" bind even possible, and it should still be an option, not the default.
6. **Browser Panes.** Letters the Desk does not claim reach the page, so most accesskeys keep working [BL]. Decide one case explicitly: `Alt+←/→` is Chrome's back/forward [CH], but Desk focus in this sketch. The recommendation is that **the Desk wins, for one grammar everywhere**, while back/forward stays on the Pane toolbar, the mouse's side buttons and `Alt+[`/`Alt+]` inside browser Panes. A switch can hand `Alt+←/→` back to the page.
7. **macOS.** Default the Desk mod to **Cmd** (Herdr, Warp, Ghostty and Zed all do), because Option types characters [AP]. Offer "Left Option acts as Alt" as a switch, the way Ghostty and kitty do with `left` [G1][K1].

## 8. Discoverability patterns

How keyboard-heavy apps teach their keys. Tags as in section 7.

- **VS Code Command Palette** (`Ctrl+Shift+P`). It reaches every command, shows each command's shortcut beside it, and keeps the 50 most recent commands at the top. Typing `?` lists the palette's modes [V6][V7]. After `Ctrl+K` the status bar says "(Ctrl+K) was pressed. Waiting for second key of chord..." [V8]. The Keyboard Shortcuts editor searches by command or by key, shows conflicts ("Show Same Keybindings"), and right-clicking any action offers "Configure Keybinding" [V5].
- **Raycast Action Panel** (`⌘K`). It lists the actions for the selected item with their shortcuts on the right and filters them by fuzzy search. Enter runs the first one. The manual's advice: press ⌘K whenever unsure [R1].
- **Linear.** `Cmd/Ctrl+K` opens a command menu that navigates and runs actions by typing [L1]. `?` opens a searchable list of every shortcut [L2].
- **Obsidian.** The palette (`Ctrl/Cmd+P`) fuzzy-matches ("scf" finds Save current file), lists recent commands first, and supports pinned commands. The help calls it the quickest way to look up a command's hotkey [O3]. Settings → Hotkeys has search and a "has hotkey" filter [O2].
- **which-key** (built into Emacs 30, opt-in). After a partial chord and about a second's pause, a table of the keys that can follow appears [E1].
- **Helix info box.** It appears right after `Space`, `Ctrl-w` and similar keys and lists each next key with its description (`auto-info`, on by default) [H1][H2][H3].
- **zellij status bar.** It always shows the current mode's keys. In the unlock-first preset it walks you through the chord as you type (0.41), and the compact bar can show the hints as a tooltip on entering a mode (0.43) [ZJ3][ZJ4].
- **tmux.** Prefix then `?` lists every key with its note, and prefix then `/` describes one key. Right-click menus show each item's key in brackets [T1][T2].
- **Window managers** (sections 1, 3): niri's Important Hotkeys overlay opens once at the first start, and binds opt in with plain titles. Omarchy's `Super+K` searchable sheet *runs* the bind you pick, and its menu tree can be opened at any route.

**What this shows.**
- Three surfaces cover it: (1) one palette for everything, recent commands first, each row showing its key; (2) a hint box the moment a leader key is pressed; (3) shortcuts printed wherever the action also lives as a button or menu item, with "change this key" one right-click away.
- Showing the key sheet once at the first start (niri) costs nothing and teaches the one key a person must remember (Omarchy: "the only hotkey you actually have to memorize").

---

## 9. Comparison for a non-developer's Desk of Agents

| | niri | Hyprland | Omarchy | Herdr (TUI + app) | zellij / tmux |
|---|---|---|---|---|---|
| Spatial model | endless strip of columns; vertical dynamic workspaces | per-workspace layouts: tree, master, monocle, scrolling | Hyprland, with dwindle/scrolling/floating chosen per workspace | Space (repo) → tab (task) → split panes | session → tab/window → panes |
| On open | new column right of focus; others untouched; rules for width, workspace, focus | static rules at open; split direction from width-to-height ratio or cursor | launch-or-focus per app key | agent skill: sibling pane, split by aspect, `--no-focus` | swap layouts re-arrange by pane count |
| Scratch / floating | floating layer per workspace; no pinning yet | special workspaces, pin, groups | `Super+S` scratchpad, Quake console, pop-out, groups | floating blocks, peek drawers, peek a sub-agent terminal | floating panes |
| Persistence | monitor memory only | none in core (not found) | layout per workspace persists | layout, cwd and focus restored; native agent resume | zellij resurrection (commands wait for Enter); tmux until the server exits |
| Theme / motion | springs, `off`/`slowdown` switch | animation tree with bezier or springs | one `colors.toml` → every app | theme files; mods animate natively | themes |
| Drive by program | JSON socket; any action; full-state event stream | two sockets; Lua eval; C++ plugins | shell scripts over hyprctl; menu routes | CLI + JSON socket + events; agent skill; JS mods; `herdr-app do` | zellij WASM plugins with permissions; tmux commands |
| Config errors | keeps old config, shows a notice, `niri validate` | refuses the reload and pops an error; emergency binds | inherits Hyprland's handling | keeps last good, writes `<name>.error`, reset chord | not checked |

Sources: sections 1–5.

---

## 10. What Banda could take (ranked)

1. **One command list behind everything.**
   - Keys, the Desk menu, the palette, Pane header buttons, the key sheet and **Agents** all call the same named commands with typed arguments: `pane.open {kind, place?, focus?}`, `pane.focus {direction}`, `pane.swap`, `pane.close`, `pane.zoom`, `desk.layout`, `space.select`, and so on.
   - Each command has a plain-words description and a default key.
   - Agents call commands through the engine API, get back JSON with the new IDs, and never get a dialog (missing arguments are errors).
   - Precedents: herdr-app ("the one way to change anything"), niri ("most actions… `niri msg action`"), Hyprland dispatchers, and Omarchy's description-carrying `o.bind`. This is the deep module; keys are only one caller.
2. **Calm placement rules.** niri principles 1–2, applied to Agents:
   - (a) Opening a Pane never resizes or moves the focused Pane.
   - (b) An Agent-opened Pane does **not take focus** by default (niri `open-focused false`, Hyprland `no_initial_focus`, herdr `--no-focus`). It appears with a badge, and the person decides when to look.
   - (c) Keep today's rule "takes the tile that last showed its kind". It is a tab inside an existing tile, so nothing shrinks.
   - (d) When a new tile is needed, follow Herdr's agent-skill heuristic: split the wide side, and avoid repeated same-direction splits.
3. **A per-Desk layout switch, visible and persisted** (Omarchy `Super+L` plus a clickable bar mark; Hyprland per-workspace layouts).
   - Offer **Split** (today's tree) and **Strip** (niri-style columns with 1/3, 1/2, 2/3 presets that never shrink each other), with Split as the default. Possibly also **Focus** (monocle: one Pane, the rest as tabs).
   - This fits the owner's "options as switches" rule. Strip is the best answer to "Agents keep opening things".
4. **The key grammar sketch** (owner's choice: Left Alt as mod; Omarchy-like, one ring inside Super). The principle is *Super acts on the desktop, Left Alt acts on the Desk*, with the same verbs.

   | Keys | Does | Precedent |
   |---|---|---|
   | `Alt+Arrows` | focus the neighbouring Pane | Omarchy `Super+Arrows`, niri `Mod+Arrows`, herdr-app `alt-arrows`, Banda today |
   | `Alt+Shift+Arrows` | swap / move the Pane that way ("Shift carries it along") | Omarchy `Super+Shift+Arrows` |
   | `Alt+Ctrl+Arrows` | resize the Pane's edge (in Strip: Left/Right cycle width presets) | niri `Mod+R`, Omarchy resize |
   | `Alt+Return` | new Thread with an Agent (the main object) | Omarchy `Super+Return` |
   | `Alt+O`, then a letter | **Open…** sheet: `T` terminal, `B` browser, `F` files, `D` database, `N` document, `A` Agent. **Open-or-focus**: focuses the existing Pane of that kind; `Shift` opens another | Omarchy launch-or-focus; which-key style sheet |
   | `Alt+W` | close the Pane | Omarchy `Super+W` |
   | `Alt+Z` | zoom the Pane (full Desk) and back | tmux/herdr zoom |
   | `Alt+S` | drawer (scratch Pane over the Desk), e.g. a quick Thread | Omarchy `Super+S`, Hyprland special workspace |
   | `Alt+E` | pop the Pane out as floating / back in | Omarchy `Super+O` ("pop") |
   | `Alt+PageDown` / `Alt+PageUp` | next / previous tab inside the tile (not `Alt+Tab`: Omarchy's Hyprland binds take `Alt+Tab`, `Alt+Shift+Tab` and `Ctrl+Alt+Tab` before any app sees them) | browser `Ctrl+PgUp/PgDn` habit; [tiling.lua](https://github.com/omacom/omarchy/blob/v4.5.0-rc2/default/hypr/bindings/tiling.lua) |
   | `Alt+1..9` | go to Space N | Omarchy `Super+1..9`, herdr-app `alt-1..9` |
   | `Alt+Shift+1..9` | send the Pane to Space N | Omarchy `Super+Shift+N` |
   | `Alt+Space` | Desk menu / palette (search every command; each row shows its key) | Omarchy `Super+Space` |
   | `Alt+K` | key sheet (searchable; picking a row runs it); also shown once at first start | Omarchy `Super+K`, niri overlay |
   | `Alt+\` / `Alt+Shift+\` | split right / down (today's `Ctrl+\`, moved) | VS Code / Banda today |
   | `Alt+V` | cycle the Desk **v**iew/layout (Split → Strip → Focus); not `Alt+L`, which is readline's downcase-word | Omarchy `Super+L` |

   Rules that go with it:
   - **Bind by physical key** (`KeyboardEvent.code`, as `keys.ts` already does for `KeyW`, and Omarchy does with `code:` binds). Then `Alt+W` works on a Russian or German layout, and the key sheet shows the key as the active layout prints it.
   - **Terminal Panes keep bash's Alt keys.** Default bash 5.3 binds `Alt+` b c d f g l n p r t u x y . _ < > - 0–9 \ and more, and **readline maps `Alt+Shift+letter` to the same command as `Alt+letter`** (`do-lowercase-version`). Typing `ESC f` is the same as `M-f`. That comes from `bind -p` on bash 5.3.20 with an empty inputrc on this machine and the readline docs ([Miscellaneous Commands](https://www.gnu.org/software/bash/manual/html_node/Miscellaneous-Commands.html), [Commands For Moving](https://www.gnu.org/software/bash/manual/html_node/Commands-For-Moving.html)). The sketch therefore takes letters only from the free set **a e h i j k m o q s v w z**, plus Return, Space, arrows and PageUp/PageDown. `Alt+Space` (set-mark) and `Alt+Tab` (dynamic-complete-history) are bound in bash but rarely used. `Alt+Tab` is out anyway: Omarchy's window manager takes it.
   - **Deliberate exceptions**, all documented and rebindable:
     - `Alt+digit` takes bash's digit-argument.
     - `Alt+Shift+digit` takes `M-!`/`M-@`/`M-#`/`M-$`, which are completions and insert-comment on a US layout.
     - `Alt+\` takes delete-horizontal-space.

     Non-developers rarely use any of them. Per-Pane-kind sections in the key file can give any key back to the program (herdr-app's `"terminal"` action).
   - **Two of today's keys clash in a terminal Pane.** `Ctrl+\` is the tty QUIT character (SIGQUIT) and `Ctrl+W` is word-erase ([termios(3)](https://man7.org/linux/man-pages/man3/termios.3.html)). `Ctrl+W` also closes a tab in browsers. Moving both to Alt removes these clashes.
   - **How Left Alt is read** (section 7a): decide in the Electron main process (`before-input-event`), and only when the held Alt was the one pressed as `AltLeft`. AltGr/AltRight stays free for typing. There is no application menu, so a lone Alt does nothing.
   - **Browser Panes.** `Alt+←/→` belongs to Desk focus (one grammar everywhere). Back and forward stay on the toolbar, the mouse side buttons and `Alt+[`/`Alt+]`. A switch can give `Alt+←/→` back to the page. Unclaimed `Alt+letter` keys reach the page, so most accesskeys keep working.
   - **A per-Pane lock** (header toggle, plus one bind) sends every key to the program, for people who run zellij, tmux or Emacs inside a terminal Pane.
   - **macOS.** The Desk mod defaults to **Cmd** (`Cmd+Arrows` etc.), because Option types characters. "Left Option acts as Alt" is a switch.
   - **Not verified here:** whether `Alt+Space` is taken on Windows (system window menu) or on GNOME and KDE. If it is, `Alt+K` and `Alt+O` still reach the same palette and sheet.
5. **Mouse parity built in** (every row above has a visible twin):
   - Pane header buttons for split, zoom, pop out and close.
   - A header **grip** to drag a Pane, with an insert hint where it will land (niri insert hint; herdr: centre drop swaps, edge drop places beside).
   - Border drag to resize; **double-click a border** resets it or toggles full width (niri).
   - A right-click header menu and a `+` button that open the same Open… sheet **with key hints next to each item**.
   - A clickable layout mark (Omarchy).
   - In Strip: wheel/touchpad scrolls the strip, plus a position bar showing where you are (PaperWM).
   - `Alt`+drag anywhere as the power path (niri/Hyprland `Mod`+drag).
   - An **Overview**: zoom out to every Space's Desk and drag Panes between them (niri).
6. **Attention roll-up.** Pane → tab → Desk → Space status, from most to least urgent: blocked > done > working > idle (herdr-app). Show it on tabs, Desk thumbnails and the Space list. `done` means "finished while you were not looking". Agents waiting on the person should never be hidden by a collapsed tab.
7. **A key file the person or an Agent edits**, done the safe way:
   - **Two layers.** Shipped defaults are read-only and refreshed on update. The person's override file loads after them (Omarchy). Verbs: add, replace (`rebind`), remove (`unbind`), plus switches to drop whole families.
   - **Format.** Bind by context (`desk`, `thread`, `terminal`, `browser`, `document`); each action is a **command name** from item 1, or `pass` to hand the key to the Pane (herdr-app `keys.json` sections).
   - **Live reload, keep the last good file.** On an error show a visible notice naming the file and line, and offer a `check` command (niri `validate`, herdr-app `<name>.error`, Hyprland error popup).
   - **A reset chord that cannot be rebound** (herdr-app `ctrl-alt-shift-escape`), and emergency binds if loading fails before any bind exists (Hyprland).
   - **An `AGENTS.md`-style note next to the file**, rewritten on every start, so an Agent edits the right file correctly (herdr-app).
   - The descriptions *are* the key sheet (Omarchy's `o.bind` puts the description in second place, and every shipped key bind has one).
8. **Scratch and drawers.** One summonable overlay layer per Desk, e.g. a quick Thread or the Inbox (Hyprland special workspaces, Omarchy scratchpad and Quake console, PaperWM scratch layer, herdr-app peek drawers). It covers "I need it for a second" without re-tiling.
9. **Event stream with the full state first** (niri), plus a typed command socket (Hyprland/Herdr). Agents and extensions subscribe to Desk events (`pane.opened`, `pane.focused`, `layout.changed`, `attention.changed`) and never poll.
10. **One theme file → every Pane** (Omarchy `colors.toml` + templates): semantic tokens plus the 16 ANSI colours, so terminal Panes, the browser chrome and Threads change together. Light/dark is a property of the theme.
11. **Motion as niri does it.** Critically damped springs for movement and resize, short ease-out for open/close, and synchronized resize and view movement. One global "Reduce motion / off" switch. Keep horizontal movement for spatial awareness.
12. **Restore honestly.** Restore layout, folders and focus. Resume Agent sessions where the harness supports it (Herdr). Never re-run commands silently (zellij waits for Enter).

---

## 11. What does not fit a non-developer (and why)

- **Config files as the person's main interface** (niri KDL, Hyprland Lua, AeroSpace TOML). Non-developers should change things through the UI or by asking an Agent. Keep the file as the *backing store* that an Agent can edit (herdr-app pattern), not as the main surface.
- **Modal key sets and prefixes as the primary path** (Hyprland submaps, tmux `C-b`, zellij modes). They create invisible state; even Hyprland's wiki warns you can get stuck. A one-shot leader (`Alt+O`, then a letter) is fine only if a sheet shows the options at once and `Escape` always leaves.
- **Mod+drag as the only pointer path** (niri/Hyprland/Omarchy `Super`+drag). Nobody discovers it. Provide visible grips and buttons first.
- **Dwindle's ratio-based split direction** ("splits are NOT PERMANENT"). Where the next split goes depends on the tile's width-to-height ratio, which is unpredictable for newcomers. Keep explicit right/down or a single clear rule.
- **Numbered workspaces 1–10 per monitor, or endless vertical workspaces.** Banda already has the Space as its unit (GLOSSARY). A second level of "workspaces" inside a Desk would duplicate it. Use tabs within tiles and Spaces above.
- **Regex window rules on class/title** (niri, Hyprland). Replace them with plain Pane-kind rules ("Browser Panes open in the right column at 1/3").
- **In-process native plugins** (Hyprland C++ `.so`: "Writing a plugin to wipe your computer is easy"). Prefer sandboxed extensions with explicit permissions (zellij WASM permissions; herdr-app JS mods without DOM, Node or `setTimeout`).
- **vim `hjkl` as the default** (niri, herdr-app). Non-developers know arrows. `hjkl` can be an optional set.
- **Hot corners and bare-modifier taps by default** (niri, PaperWM). A bare Alt tap is especially risky in an Electron app on Linux and Windows (menu-bar toggle; section 7a). Offer them as options only.
- **Launch-on-restore of arbitrary processes.** No project in this survey revives them safely (Herdr, zellij). Do not promise it.

---

## 12. Evidence limits

- **Versions move fast.**
  - The Hyprland wiki documents the latest git (Lua). Older Hyprland versions use hyprlang syntax.
  - niri release binds and the Mod-tap Overview are "next release" (on `main`, not in v26.04).
  - Omarchy facts come from v4.5.0-rc2 (installed and identical to the upstream tag). v4.0.6 stable differs only in small binds: no `Super+Q`, Quake console or `Super+M`, and older menu commands. The omarchy.org manual pages do not state the version they cover.
- **Not verified.**
  - niri has no built-in session restore beyond monitor memory, and Hyprland has none in core. I found none in the pages I read, but did not read the whole niri wiki or the Hyprland source.
  - Whether Hyprland keeps the previous config on *every* kind of Lua error. The docs say a fundamental syntax error means it "refuse[s] to reload", but other errors can partially apply.
  - "Calm" is my reading of niri's stated principles; I found no primary user research.
- **Herdr-app is three weeks old** (repo created 2026-10-16). Its docs and defaults may change weekly.
- **Superlogical/Rex** publish no layout, key or extension docs. Rex is a macOS-only public test (since 2026-10-05), and the multiplexer is unreleased.
- **Sections 7–8** come from a parallel survey that also used primary sources. Its limits:
  - Arc was read from a Wayback copy (2026-07-25), covering macOS and Windows only.
  - Chromium's Wayland AltGr bug reports need sign-in and were not checked, so **Left-vs-Right Alt on Wayland is unverified**.
  - MDN's accesskey table says Chrome on Linux uses Control+Option, which looks wrong; Blink's source says Alt.
  - Raycast and Linear pages were read through a summarizing fetcher.
  - It found no primary source showing shortcuts in Linear's or VS Code's tooltips, nor Obsidian's conflict display.
  - Versions: zellij 0.45.1, tmux 3.8, Zed 1.26.2, Ghostty 1.4.0, Zen 1.24b.
  - I re-checked these against the fetched files: the Electron `autoHideMenuBar` text, Blink's `kAccessKeyModifiers`, Ghostty's `macos-option-as-alt` default, and the zellij preset.
- **Local data.** Bash defaults come from `bind -p` on GNU bash 5.3.20 with an empty inputrc; zsh and fish were not checked.

---

## 13. Sources

**niri**
- README: https://github.com/niri-wm/niri/blob/main/README.md
- v26.04 release notes: https://github.com/niri-wm/niri/releases/tag/v26.04
- Design Principles: https://niri-wm.github.io/niri/Development%3A-Design-Principles.html
- Workspaces: https://niri-wm.github.io/niri/Workspaces.html
- Tabs: https://niri-wm.github.io/niri/Tabs.html
- Overview: https://niri-wm.github.io/niri/Overview.html
- Floating Windows: https://niri-wm.github.io/niri/Floating-Windows.html
- Gestures: https://niri-wm.github.io/niri/Gestures.html
- IPC: https://niri-wm.github.io/niri/IPC.html
- FAQ: https://niri-wm.github.io/niri/FAQ.html
- Getting Started: https://niri-wm.github.io/niri/Getting-Started.html
- Configuration (Introduction, Key Bindings, Layout, Window Rules, Animations, Recent Windows, Include, Miscellaneous): https://niri-wm.github.io/niri/Configuration%3A-Introduction.html (sibling pages under the same path)
- Default config: https://github.com/niri-wm/niri/blob/main/resources/default-config.kdl and https://github.com/niri-wm/niri/blob/v26.04/resources/default-config.kdl
- Source: https://github.com/niri-wm/niri/blob/main/src/layout/scrolling.rs, https://github.com/niri-wm/niri/blob/main/src/niri.rs, https://github.com/niri-wm/niri/blob/main/src/ui/config_error_notification.rs

**Hyprland**
- Wiki source, under https://github.com/hyprwm/hyprland-wiki/blob/main/content/:
  - `configuring/core/_index.md`
  - `configuring/layouts/{dwindle,master,monocle,scrolling,custom}-layout(s).md`
  - `configuring/core/binds/{_index,flags,submaps,gestures}.md`
  - `configuring/core/binds/devices/mouse.md`
  - `configuring/core/dispatchers.md`
  - `configuring/core/rules/window-rules.md`
  - `configuring/core/animations.md`
  - `configuring/core/config-options.md`
  - `configuring/core/advanced-configuration/using-hyprctl.md`
  - `ipc/_index.md`
  - `hyprland-plugins/using-plugins.md`
  - `hyprland-plugins/development/getting-started.md`
- Releases: https://github.com/hyprwm/Hyprland/releases/tag/v0.57.0, …/v0.56.0, …/v0.55.0, …/v0.54.0
- Official plugins: https://github.com/hyprwm/hyprland-plugins
- Plugin removal commit: https://github.com/hyprwm/hyprland-plugins/commit/3aa21f2e0ca72412f1b434c3126f8f1fec3c716c

**Omarchy**
- Site: https://omarchy.org
- Repo and releases: https://github.com/omacom/omarchy, https://github.com/omacom/omarchy/releases
- Manual: https://omarchy.org/manual/ (navigation, hotkeys, themes, making-your-own-theme, coming-from-mac-or-windows)
- Omarchy 3 manual: https://learn.omacom.io/2/the-omarchy-manual
- Files at tag v4.5.0-rc2:
  - `default/hypr/bindings/{tiling,utilities,applications,clipboard,input-method}.lua`
  - `default/hypr/{helpers,workspace-layouts}.lua`
  - `config/hypr/{hyprland,bindings}.lua`
  - `config/herdr/config.toml`, `config/tmux/tmux.conf`
  - `default/omarchy/omarchy-menu.jsonc`, `default/themed/`, `themes/tokyo-night/colors.toml`
  - `bin/omarchy-{menu,menu-keybindings,launch-or-focus,theme-set,theme-set-herdr-machines,refresh-config,hyprland-workspace-layout-toggle}`

**Herdr**
- TUI repo: https://github.com/herdrdev/herdr
- Site: https://herdr.dev/
- Docs: https://herdr.dev/tui/docs/concepts/, https://herdr.dev/tui/docs/socket-api/, https://herdr.dev/tui/docs/session-state/
- Layouts: https://herdr.dev/layouts/
- App repo: https://github.com/herdrdev/herdr-app (`Cargo.toml`, `CHANGELOG.md`, `defaults/AGENTS.md`, `defaults/keys.json`, `defaults/keys.macos.json`)
- Local: `herdr --skill` (0.9.5)

**Superlogical / Rex**
- https://www.superlogical.com
- https://www.superlogical.com/updates/public-testing-beginning
- https://mitchellh.com/writing/superlogical
- Cross-check only: https://www.devclass.com/devops/2026/08/01/dev-who-gave-hashicorp-its-name-returns-with-a-faster-terminal-multiplexer/5282025

**Others**
- PaperWM: https://github.com/paperwm/PaperWM/blob/develop/README.md
- AeroSpace: https://github.com/nikitabobko/AeroSpace/blob/main/README.md, https://nikitabobko.github.io/AeroSpace/guide
- zellij: https://zellij.dev/documentation/layouts.html, https://zellij.dev/documentation/swap-layouts.html, https://zellij.dev/documentation/session-resurrection.html, https://zellij.dev/documentation/plugins.html, https://zellij.dev/documentation/plugin-api-permissions.html
- tmux: https://github.com/tmux/tmux/wiki/Getting-Started
- termios: https://man7.org/linux/man-pages/man3/termios.3.html
- Bash readline commands: https://www.gnu.org/software/bash/manual/html_node/Miscellaneous-Commands.html, https://www.gnu.org/software/bash/manual/html_node/Commands-For-Moving.html
- Banda (local): `~/code/bandaso-app/app/web/src/keys.ts`

**Sections 7–8 (tags)**
- [Z1] https://github.com/zed-industries/zed/blob/main/assets/keymaps/default-linux.json · [Z2] …/default-macos.json · [Z3] https://github.com/zed-industries/zed/blob/main/docs/src/key-bindings.md · [Z4] https://github.com/zed-industries/zed/blob/main/assets/settings/default.json
- [V1] https://code.visualstudio.com/shortcuts/keyboard-shortcuts-linux.pdf · [V2] https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf · [V3] https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalActions.ts · [V4] https://code.visualstudio.com/docs/terminal/advanced · [V5] https://code.visualstudio.com/docs/configure/keybindings · [V6] https://github.com/microsoft/vscode-docs/blob/main/docs/editing/getting-started/userinterface.md · [V7] https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/workbench.contribution.ts · [V8] https://github.com/microsoft/vscode/blob/main/src/vs/platform/keybinding/common/abstractKeybindingService.ts · [V9] https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts
- [W1] https://docs.warp.dev/terminal/windows/split-panes · [W2] https://docs.warp.dev/getting-started/keyboard-shortcuts
- [A1] https://resources.arc.net/hc/en-us/articles/20595231349911-Keyboard-Shortcuts (read via the Wayback copy of 2026-07-25; live page returned 403)
- [ZN1] https://github.com/zen-browser/desktop/blob/dev/src/browser/base/content/zen-keysets.inc.xhtml · [ZN2] https://github.com/zen-browser/desktop/blob/dev/src/zen/kbs/ZenKeyboardShortcuts.sys.mjs
- [FF1] https://github.com/mozilla-firefox/firefox/blob/main/browser/base/content/browser-sets.inc.xhtml · [FF2] https://github.com/mozilla-firefox/firefox/blob/main/dom/events/GlobalKeyListener.cpp
- [O1] https://github.com/obsidianmd/obsidian-help/blob/master/en/User%20interface/Tabs.md · [O2] …/User%20interface/Hotkeys.md · [O3] …/Plugins/Command%20palette.md
- [T1] https://github.com/tmux/tmux/blob/master/key-bindings.c · [T2] https://github.com/tmux/tmux/blob/master/tmux.1
- [ZJ1] https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/assets/config/default.kdl · [ZJ2] https://zellij.dev/documentation/keybinding-presets.html · [ZJ3] https://github.com/zellij-org/zellij/releases/tag/v0.41.0 · [ZJ4] https://github.com/zellij-org/zellij/releases/tag/v0.43.0
- [G1] https://github.com/ghostty-org/ghostty/blob/main/src/config/Config.zig · [WE1] https://github.com/wezterm/wezterm/blob/main/docs/config/default-keys.md · [K1] https://github.com/kovidgoyal/kitty/blob/master/kitty/options/definition.py
- [R1] https://manual.raycast.com/action-panel · [L1] https://linear.app/enablement/guide/navigating-linear · [L2] https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- [E1] https://github.com/emacs-mirror/emacs/blob/emacs-30/etc/NEWS · [H1] https://github.com/helix-editor/helix/blob/master/book/src/editor.md · [H2] https://github.com/helix-editor/helix/blob/master/helix-term/src/keymap.rs · [H3] https://github.com/helix-editor/helix/blob/master/book/src/keymap.md
- [RL] https://tiswww.cwru.edu/php/chet/readline/readline.html · [X1] https://invisible-island.net/xterm/manpage/xterm.html
- [UC] https://www.w3.org/TR/uievents-code/ · [UK] https://www.w3.org/TR/uievents-key/ · [UE] https://www.w3.org/TR/uievents/ · [M2] https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState · [M3] https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/accesskey · [HTML] https://html.spec.whatwg.org/multipage/interaction.html#the-accesskey-attribute
- [CR1] https://codereview.chromium.org/2630213003 · [CR2] https://chromium.googlesource.com/chromium/src/+/main/ui/events/ozone/layout/xkb/xkb_modifier_converter.cc · [BL] https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/input/keyboard_event_manager.h
- [EL1] https://www.electronjs.org/docs/latest/api/browser-window · [EL2] https://www.electronjs.org/docs/latest/api/menu · [EL3] https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event
- [CH] https://support.google.com/chrome/answer/157179 · [AP] https://support.apple.com/guide/mac-help/use-the-keyboard-viewer-on-mac-mchlp1015/mac
