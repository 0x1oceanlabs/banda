---
status: accepted
date: 2026-11-01
---

# Settings is a Pane that edits the files

ADR 0005 (decision 11) made Banda's config text files in `~/.config/banda/` and promised that "the settings page edits the same files, so there is one source of truth". ADR 0007 put that page last, after a `look.set` and MCP tools. Roma then dropped those: "всё делать через конфиг файлы", so Agents and people edit the files themselves.

By 2026-11-01 there are three files:

- **`look.toml`** holds the theme, tiles, columns, font, motion, sounds and calls (ADR 0007, 0009 and 0011).
- **`sidebar.toml`** holds the sidebar's arrangement and its presets (ADR 0008).
- **`harnesses.toml`** holds the Harnesses, and the engine reads it once at start.

Only the sidebar's view menu writes a file from the window. The Harnesses Pane shows each Harness and signs in and out. What Enter does in the composer is kept in the window's localStorage, outside every file.

Roma asked for a visual settings module where Claude Code, Codex and the rest are connected too, looking at how T3 Code does it. Roma first decided it opens as a window, then, once it was built, that it opens in a Pane (decision 1).

**What T3 Code does.** Read from its source on 2026-11-01:

- Settings is a route shown as a large modal, and Ctrl+, opens it. It has 22 sections.
- One row pattern runs through every section: the title and description on the left, the control on the right, in cards. A ↶ reset shows only when a value differs from its default.
- A search over an index jumps to a row and pulses it.
- A change applies at once, and a text field commits when it loses focus.
- The providers are a master–detail view: status, version, account, sign-in, runtime, environment and models.
- Settings live in three JSON files. Each is written sparse and atomic, watched, and streamed to the window, so a hand edit shows.

**What it gets wrong for us:**

- The search index, the reset checks and the list of changed settings are each kept by hand beside the rows, and they drift.
- Settings live in three files plus scopes.
- A file that does not parse falls back to the defaults with only a line in the log.

**Decision.**

1. **Settings is a Pane** (_decided_ 2026-11-02: "настройки должны открываться в пайне не отдельным окном"; first "отдельное окно").
   - It is the window's own Pane, `window.settings`, opened as any Pane is: right of the focused Pane, in its Space. Only one is open at a time; opening it again goes to it, on whatever workspace it is. Its × closes it, as the Pane's close key does.
   - **Why not a window.** Banda is where a Person works, in its workspaces and with its keys. A second window was one more for the desktop to place, outside both; a Pane sits beside the Thread it is changing, moves and widens as every other, and the keys stay Banda's.
   - **Ways to open it:**
     - Alt+, (comma).
     - The Banda menu (ADR 0017), which also finds each row.
     - A gear at the bottom of the sidebar (_decided_).
     - Wherever a setting is the answer: a Thread's "Sign in" opens Agents at that Harness.
   - A link names a section and a row, such as `agents/codex`. The Pane keeps its link in its args, so it comes back where it was.
   - In a narrow column the sections are a row of icons over the page; from 48 rem wide, a list beside it, as the mockup has it.
   - The Harnesses Pane becomes its Agents section.

2. **The files stay the one source, and the Pane only edits them.**
   - The window keeps no setting of its own. Its storage keeps state only: workspaces, drafts and what was seen. The Enter key's choice moves into a file.
   - A change applies at once, with no Save button. A text field writes on Enter or when it loses focus.
   - A hand edit shows as soon as the file is saved. The Pane shows what the follower read, never a copy of its own.
   - A file with a mistake is not hidden. Its row names the file, the line and what is wrong. The last good value stays in force (ADR 0005, decision 11), and "Show line" opens the file at that line.

3. **One file per module** (_decided_: "по файлу на модуль").
   - **The files:**
     - `look.toml`: the look, sounds and calls, as ADR 0007, 0009 and 0011 have it;
     - `sidebar.toml`;
     - `harnesses.toml`;
     - `keys.toml`, the keys (ADR 0005, decision 11);
     - a later module's own file, such as `terminal.toml` or `browser.toml`.
   - The agents module's own preferences, such as what Enter does, go in `agents.toml`.
   - Sections follow what a Person looks for, not the files. So Sounds & calls is a section of its own, yet its keys stay in `look.toml`. Each section names its file and opens it.

4. **Each setting is described once, in Rust.**
   - Each file's settings are already Rust structs with a doc comment on each key. They also derive a JSON Schema with `schemars`: each key's type, its default, the values or range it allows, and its doc comment as the description.
   - **The schemas go into the contract**, as ts-rs exports the types (ADR 0014). From them:
     - the Pane builds its rows, its search and its ↶;
     - Banda's skill shows every key (ADR 0012);
     - each template file starts with a `#:schema` line, so an editor completes and checks the keys as the Person types.
   - **Custom rows.** A row that a schema cannot draw well comes as a component the module gives for that section, such as a theme with its preview or a Harness with its sign-in. One row component draws everything else.
   - So a new key shows in the Pane, its search and the skill with no list kept by hand.

5. **One program writes, and keeps the Person's text.**
   - `banda settings` runs without the engine, as `banda look` does (ADR 0007, decision 10).
     - `set <file> <key> <value>` first checks the value against the schema. Then it changes that one key with `toml_edit`, so comments, order and every other line stay.
     - `reset <file> <key>` takes the key out, and the layer below shows again.
     - `check [files]` checks every file Banda reads; `banda look check` stays.
   - It writes whole or not at all: a new file, then a rename. A file that is a link stays one, as `sidebar.toml` is written today.
   - The desktop calls it for the Pane, and the page never touches a file.
   - An Agent need not use it. It edits the file and checks it, as Roma decided for the look.

6. **Each value says where it comes from.**
   - For each key, the follower reports the layer that set it: Banda's default, the theme, Hyprland, or the Person's file and its line. The Pane shows this beside the control.
   - A key the Person set has a dot and a ↶. One that follows Hyprland or the theme says so.

7. **Agents, as T3 Code's providers.**
   - **One card per Harness entry**, showing:
     - its icon, name and version;
     - whether it is installed, and whether it is signed in and as whom;
     - an on/off switch;
     - Sign in and Sign out (ADR 0004).
   - **Under the card:**
     - what a new Thread starts with (ADR 0006, decision 3): the model and the mode;
     - how the Harness starts: its command, arguments and environment, with secret values hidden.
   - **"Add a Harness"** adds any agent that speaks ACP, or a second account of one, as a new entry in `harnesses.toml`.
   - **Writing to an Agent:** what Enter does, and whether a message sent while the Agent works waits in the queue or steers it.

8. **Fewer sections than T3 Code's 22.**
   - The main ones: General, Appearance, Sidebar, Sounds & calls, Agents, Terminal, Browser and Keys.
   - Then under Banda: Modules, and Files (where each file is, and whether it reads).
     - _Changed on 2026-11-09 (#1043)._ That section is "Settings files", with the id `settings-files`, apart from the Files App's own "Files" section.
   - A module from elsewhere adds its section through its manifest (ADR 0005, decision 12).

9. **It looks like the mockup Roma approved**, `docs/adr/0016-settings-window.html`.
   - The left side has the sections and a search, opened with `/`.
   - Above the page are where you are and a close button.
   - Rows sit in cards, as in T3 Code. A line at the bottom says whether every file reads.

**Consequences.**

- The engine reads `harnesses.toml` again when it changes, as the look follows its files. Today it reads it once at start.
- Every settings struct derives a schema as well as its type. Resolving the look also records where each key came from.
- This ADR replaces ADR 0007's step 6, "`look.set` and the MCP tools, then a settings page on the same file".
- The order of work, each step its own PR:
  1. This ADR, with the mockup.
  2. The schemas: `schemars` on every settings struct, exported into the contract; `#:schema` lines in the templates; `banda settings check`.
  3. The writer, `banda settings set` and `reset`, and where each value comes from.
  4. The window: the Electron window, Alt+, and the gear in the sidebar; then the sections, the search and the one row; then Appearance.
  5. Agents: the Harnesses Pane moves in, the window writes `harnesses.toml`, and the engine reads it again on a change.
  6. Sidebar, Sounds & calls, and General, with the Enter key moving into `agents.toml`.
  7. Keys, with `keys.toml`: the file's lines, each a key and its action, a key changed or taken out; the key sheet (Alt+K) keeps the one list of every action, and the section opens it; and the reset chord.
  8. Settings move from their own window into a Pane (decision 1, 2026-11-02).
