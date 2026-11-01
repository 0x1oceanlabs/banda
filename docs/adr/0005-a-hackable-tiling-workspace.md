---
status: proposed
date: 2026-11-01
---

# A hackable tiling workspace: one list of actions, calm tiles, modules on an open contract

On 2026-11-01 Roma set the direction of the whole window. Banda is **a hackable workspace for working with Agents**. It should be tiled the way niri and Hyprland tile, with workspaces, and should work like Omarchy: keyboard-heavy, yet fully usable by mouse. It offers modules (Threads, terminal, browser, then chats, files, databases and documents), and people add the modules they miss. We give a strong base and ready blocks, and people build the rest themselves.

During the same talk Roma decided these points:

- The base comes first: Threads, the terminal and the browser.
- Hackability shapes the architecture now, even though only our own modules are being built.
- The first audience is enthusiasts and AI-native people.
- Left Alt is Banda's mod key, with Omarchy-like binds for managing tiles.
- Keybinds live in a text file, Linux style. A Person edits it, or asks an Agent to.
- Everything can be done through an Agent. Each Agent gets a Banda skill that says what Banda can do, where things are and how to change them.
- Modules draw their Panes with the same shadcn/ui components that we use, so they follow the theme.
- The system is open, like Linux. A Person who installs a module from elsewhere does so at their own risk. Our base is checked.
- A Space is any folder on a machine, this one or another, and Banda's data lives outside the folder, as in T3 Code and Herdr.
- The Strip is the default layout, the workspaces live in the engine, and one list of actions with the key table below drives everything.
- One place shows what every Agent in every Space is doing, as T3 Code's sidebar does: a module of its own.
- Kept simple, as in Hyprland: Panes, a bar and a sidebar. A workspace is a screen of Panes, and it can hold Panes from different Spaces.
- There are no Agents to manage, only Threads, as in T3 Code and Herdr (ADR 0006).
- Banda's MCP server is a module of its own that every Agent reaches. The modules are deep and the whole is UNIX-like.

The evidence is in two notes: [tiling managers](../research/2026-11-01-tiling-managers.md) (niri, Hyprland, Omarchy, Herdr, Superlogical's Rex, zellij, tmux) and [hackable modules](../research/2026-11-01-hackable-modules.md) (Obsidian, VS Code, Zed, Zellij, Raycast, Notion, MCP Apps, Emacs). The nearest product is Herdr's new desktop app. It is a GPUI window over a server, with Spaces, tabs and split panes. Its whole UI is files, it keeps one list of commands, and it writes notes for Agents. It runs Agents as terminal programs, though, while Banda shows Threads in its own model (ADR 0003).

**Decision.** Roma decided the points marked _decided_. The rest are proposals that wait for his go.

1. **The first audience is enthusiasts and AI-native people** (_decided_). Every action still has a mouse path. A wider audience comes later, through the Agent: a Person says what they want, and the Agent changes the workspace. This changes the audience that ADR 0001 and `GLOSSARY.md` name.

2. **Everything is an action, kept in one list** (_decided_).
   - An action has a name, a description in plain words, typed arguments, a default key, and who may run it (the Person, an Agent or both).
   - Keys, Pane header buttons, menus, the palette, the key sheet, the CLI and Agents all call the same actions. So a button and its key cannot drift apart, and a tooltip can always show the key.
   - The workspaces' own actions and every module's actions are declared the same way, in manifests (decision 12).
   - Precedents: herdr-app's commands, niri's `niri msg action`, Hyprland's dispatchers, and Omarchy's binds, each of which carries its description.

3. **The workspaces live in the engine** (_decided_).
   - Their layout becomes engine state with commands: open, close, move, resize, layout.
   - It has an event stream that starts with the whole state.
   - Windows show the layout. The CLI and Agents change it like any other module's data.
   - Focus stays with the window.
   - Today the window keeps its Desk in its own storage, out of the Agents' reach.

4. **Tiles are calm** (niri's principles).
   - Opening a Pane never resizes or moves the Pane the Person is in.
   - An Agent opens Panes without taking the focus. A new Pane carries a mark until the Person looks at it.
   - Two rules stay as they are: a Pane already shown gets the focus, and a Pane of a kind already shown takes that tile.

5. **The Strip by default, the Split as a switch** (_decided_).
   - **The Strip** works as in niri. Columns sit on a strip that scrolls sideways. Panes stack inside a column or become its tabs, and column widths step through 1/3, 1/2, 2/3 and full.
   - **The Split** is today's tree of splits, close to Hyprland's dwindle.
   - **Its own window** (_decided_). Any Pane pops out into a window of its own and back. A window manager such as Hyprland or niri then places it beside Banda or on another monitor.
   - Each workspace keeps its choice, and `Alt+V` switches it, as Omarchy does.
   - The Strip answers "Agents keep opening things": a new Pane adds a column instead of shrinking the others. A sign-in terminal stacks under its Thread in the same column.

6. **A Space is a folder on a machine** (_decided_).
   - **What a Space is.** One folder on one machine, this one or another, plus everything Banda keeps for it: its Threads, its terminals and its browser profile. This is what a project is in T3 Code and a space is in Herdr. A Space is the boundary: an Agent works in its own Space's folder.
   - **Which folder.** Any existing folder opens as a Space, a git repository too. `~/Banda/<name>/` stays the default place for a new one.
   - **Where the data lives.** Banda's data lives outside the folder, in the engine's state on that machine (`~/.local/share/bandaso/spaces/<id>/`), as in T3 Code and Herdr. The folder holds only the work, so there is nothing to commit by mistake and nothing a sync tool can break.
     - This changes ADR 0001, decision 5: copying the folder no longer moves the Threads. An export can, once someone needs it.
     - A Space whose folder moved asks where it went.
   - **Another machine.** A Space on another machine is one whose engine runs there. The window connects to it over SSH, and the Agents, terminals and files work where the folder is. The Space list names each Space's machine. Where a browser Pane runs for such a Space is still open.
   - **Later.** A Thread in its own git worktree of the Space, as T3 Code offers.

7. **A workspace is a screen of Panes, as in Hyprland** (_decided_).
   - There are up to nine. `Alt+1…9` goes to one, and `Alt+Shift+1…9` moves the focused Pane there.
   - A workspace holds Panes from any Space. It is only how the screen is laid out: it allows and forbids nothing, and the Space stays the boundary.
   - Each Pane's header names its Space, because one screen mixes them.
   - A new Thread starts in the default Space or in one picked from the list (ADR 0006, decision 2). A Pane opened from a Thread, such as its terminal, opens in that Thread's Space. Any other new Pane opens in the default Space.
   - The workspaces live on the Person's computer. A Pane of a Space on another machine sits in them like any other.
   - **The drawer** (a proposal). It slides a quick Thread over the workspace (`Alt+S`), as Omarchy's scratchpad does.

8. **The sidebar: every Thread in every Space, in one place** (_decided_).
   - **What it shows.** Every Thread of every Space on every connected machine, each row naming its Harness and its Space. Threads come in this order: those that need the Person (a Question, a failed turn, a sign-in), those that finished while the Person was away, those that work (folded, as in T3 Code), and the pinned ones. A switch turns it to the second order, which groups the Threads under their Spaces, as Herdr does and as T3 Code's grouped sidebar does.
   - **What it does.** A click on a Thread goes to the workspace that shows it and focuses its Pane. If no workspace shows it, it opens in the current one as a new column. Each Space offers a new Thread in it. The palette searches the same Threads.
   - **Its own module, with its own data.** The agents module owns Threads and publishes what happens in them. The sidebar turns those events into "needs you", "done", "working" and "idle", and keeps the Person's own marks: seen, pinned, settled and snoozed. No other module reads those marks.
   - **Where it sits.** It is docked at the window's left edge, outside the Strip, so it never scrolls away. `Alt+A` and the bar's button show and hide it. Like any Pane, it can pop out into its own window (decision 5).
   - **Calls for the Person.** When an Agent needs the Person and the window is not in front, a system notification says so, and clicking it goes there.

9. **The bar, as in Omarchy, and minimal** (_decided_).
   - One thin line along the window's top.
   - Left: the workspaces' numbers, the ones that hold Panes and the current one, each marked while a Thread there waits for the Person.
   - Centre: the sidebar's button, an icon with a dot while any Thread waits for the Person.
   - Nothing else for now. More items come as icons from modules' manifests, once real use shows they are needed.

10. **Left Alt is the mod, and the binds come in families, as in Omarchy** (_decided_):

   | Keys | Action |
   |---|---|
   | `Alt+Arrows` | focus the Pane that way |
   | `Alt+Shift+Arrows` | move the Pane that way |
   | `Alt+Ctrl+Arrows` | resize it; in the Strip, step the column's width |
   | `Alt+Return` | a new Thread, in the default Space |
   | `Alt+O`, then a letter | open or focus a kind: `T` terminal, `B` browser, `A` Agents, `H` Harnesses; with `Shift`, open another |
   | `Alt+W` | close the Pane |
   | `Alt+Z` | zoom the Pane over the workspace, and back |
   | `Alt+S` | the drawer |
   | `Alt+A` | show or hide the sidebar |
   | `Alt+V` | Strip or Split |
   | `Alt+1…9` | go to workspace N |
   | `Alt+Shift+1…9` | move the Pane to workspace N |
   | `Alt+Space` | the palette: every action, each with its key |
   | `Alt+K` | the key sheet; picking a row runs it |

   - **Reading the key.** Electron's main process reads the keys before the page does (`before-input-event`) and acts only when the Alt held down is the left one. AltGr stays free for typing on European layouts. Keys bind by their physical place, so they work on any layout. There is no app menu, so a lone Alt does nothing.
   - **Terminal Panes keep the shell's Alt keys.** Banda takes only letters readline leaves free (`a e h i j k m o q s v w z`). `Alt+1…9` takes readline's numeric argument, which is rarely used. A per-Pane switch sends every key to the program, for tmux, zellij or Emacs.
   - **Today's `Ctrl+\` and `Ctrl+W` move to Alt.** In a terminal they are the program's: quit and word erase.
   - **On a Mac the mod is Cmd**, because Option types characters there.

11. **Config is text, Linux style** (_decided_ for the keys).
   - The files live in `~/.config/banda/`, beside `harnesses.toml`: `keys.toml`, `theme.toml` and the settings.
   - Shipped defaults are read-only. The Person's file adds, replaces or removes binds.
   - A file applies once it is saved. On an error, the last good version stays in force, and a notice names the file and the line.
   - `bandaso check` validates a file before it is saved.
   - One reset chord cannot be rebound.
   - The settings page edits the same files, so there is one source of truth.

12. **Every module, ours too, is built on the contract a module from elsewhere gets.**
   - A module has a `module.toml`. It declares its Panes, actions, commands, events, tables, MCP tools and a settings schema. The window's Pane registry, the palette, the key sheet and the skill's reference are all built from these manifests.
   - No module of ours takes a path that another module lacks. What ours need goes into the contract. An API still settling is marked unstable in the manifest, and the marks are counted, so the debt stays visible.
   - **Panes are React with `@bandaso/ui`** (_decided_): shadcn/ui on preset b0 and the theme's tokens, the same for every module. Every module follows the theme, and a new block goes into `@bandaso/ui` before any module uses it.
   - A module from elsewhere runs its engine part as a process that speaks the same engine API. The engine starts and stops it. Our modules stay crates in the one binary for now.

13. **Open like Linux** (_decided_).
    - Modules are neither sandboxed nor gated by capabilities. A module runs with the Person's rights.
    - Our base modules are checked by us. A module from elsewhere is marked as not from Banda, and it is installed only when the Person says so.
    - When an Agent asks before acting is still the Harness's decision, under the mode the Person chose (ADR 0001, decision 7).

14. **Everything through an Agent, through the MCP module** (_decided_).
    - **The MCP module is Banda's MCP server, and that is its one job.** Its interface is MCP on one side and the engine API on the other.
      - It turns the tools that modules declare in their manifests into MCP tools.
      - A tool call becomes that module's command, made by the Agent as a Participant, through the kernel's access decision.
      - No other module speaks MCP. The agents module only hands the server to each ACP session it opens.
    - **It is the same program in another mode, UNIX style.** `bandaso mcp` speaks MCP on stdio, which every ACP agent supports, and talks to the engine over the API. The session's token tells the engine which Thread's Agent is calling.
    - **The Banda skill comes through it.** Its `instructions` are the short hand-written part: the words, how to change things safely and where things live. A guide tool hands out the reference topic by topic: actions, commands, tools, config files and their schemas. The reference is generated from the manifests, so it does not go stale.
    - `bandaso describe` shows what is open and running now, to a Person and to an Agent alike.
    - Nothing is written into the Space's folder or into a Harness's own config.

15. **The base first: Threads, the terminal, the browser** (_decided_). The browser is a module: a Pane with a page that the Person and the Space's Agents share, and one sign-in profile per Space. Agents drive it through its MCP tools. It gets its own ADR when it is built.

16. **One look, and honest motion.**
    - One theme recolours every Pane, including the terminal's 16 colours and the browser's chrome. It can follow the system's theme, Omarchy's among others.
    - Motion follows niri: springs for moving and resizing, a short fade for opening and closing, and one switch to reduce motion.
    - A Thread's state rolls up from its Pane to the column, the workspace and the bar: blocked, then done, then working, then idle. A Thread waiting for the Person is never hidden in a collapsed tab.
    - A restart brings back the workspaces, the folders, the focus and the Threads' sessions. It never runs a command again by itself.

**Consequences.**

- `GLOSSARY.md` names the new audience. Words such as action, workspace, Strip, Split and drawer enter it when their behaviour is built, and the workspace replaces the Desk.
- ADR 0001, decision 10, still holds: modules from elsewhere come after our base. This ADR shapes the contract they will get, so that nothing changes for them later.
- Each new seam gets an architecture test:
  - registries come only from manifests;
  - a Pane imports only the API, `@bandaso/ui`, React and its icons;
  - every action has a description.
- The order of work, each step its own PR:
  1. the list of actions, Left Alt, `keys.toml`, the palette and the key sheet;
  2. a Space on any folder, with its data outside the folder, and Threads without Agents (ADR 0006); existing Spaces and Threads move over;
  3. the manifests of the agents and terminal modules;
  4. the workspaces in the engine, as Strips, with the Split as a switch;
  5. the MCP module, and calm placement with its marks;
  6. the sidebar, the bar and a Pane in its own window;
  7. the browser module;
  8. the Banda skill and `bandaso describe`;
  9. the theme file, motion and the drawer.

  Spaces on other machines and Threads in their own worktrees come after these.
