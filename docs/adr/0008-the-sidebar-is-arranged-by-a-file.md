---
status: accepted
date: 2026-11-01
---

# The sidebar is arranged by a file: presets, defaults, and the Person's own keys

ADR 0005 (decision 8) put every Thread of every Space in one sidebar, ordered by what needs the Person, with a switch to group them under their Spaces. On 2026-11-01 Roma saw five ways to arrange it, side by side: A, T3 Code's inbox; B, Threads under their Spaces; C, Herdr's two lists (Spaces, then sessions by priority); D, a hybrid; E, a rail. The research is in the scratch note on both sidebars, read from their source.

Roma liked A, B and C, and asked for one thing instead of three: "unify everything, and change only the sorting and the display. Better, make it hackable: the Person sets it up as they like through a config, and we give only presets and defaults. This is the point of our app: a hackable workspace, and an Agent can set the app up for its Person, as with themes."

**Decision.** Roma decided the points marked _decided_. On 2026-11-01 he accepted the rest as our defaults and asked to build, for now without search and with the presets in the view menu; each stays his to change.

1. **One sidebar; A, B and C are presets of it** (_decided_).
   - Every arrangement uses the same parts: one row, one section header, one Space header, the same marks (ADR 0005, decision 16), the same counts and the same roll-up.
   - A preset changes only three things: how Threads are grouped, how they are sorted, and what a row shows.
   - So a Person who likes A's order and B's rows does not choose between them: they set two keys.

2. **The file is `~/.config/banda/sidebar.toml`, layered as the look is** (_decided_).
   - Values come from three places, each over the one before: Banda's built-in defaults, the preset the file names, and the keys the file itself sets.
   - The Person's keys always win, so switching the preset never undoes them. ADR 0007 layers the look the same way, so a Person and an Agent learn one pattern.
   - Every key is optional. An empty file is the default preset.

3. **Presets are files, as themes are** (_decided_).
   - `preset` names one. Banda ships `inbox`, `spaces` and `places`.
   - Any other name is a file: `~/.config/banda/sidebars/<name>.toml`, with the same keys as `sidebar.toml`. A Person can copy one, share one, or ask an Agent to write one.
   - A preset file cannot name another preset, so there are no chains.

4. **The keys.** Written out with the defaults of the `inbox` preset:

   ```toml
   preset = "inbox"            # "inbox", "spaces", "places", or a file of your own

   [group]
   by = "state"                # "state", "space" or "none"
   states = ["needs", "done", "idle"]   # the sections, in this order
   bottom = ["working"]        # shelves at the bottom, each with its count
   folded = ["working"]        # sections and shelves that start folded
   limit = 10                  # rows before "Show more"; 0 shows all
   empty = "hide"              # an empty section: "hide" or "show"

   [sort]
   by = "attention"            # "attention", "changed", "created" or "title"

   [spaces]
   list = false                # a list of Spaces above the Threads, as Herdr's
   order = "changed"           # "changed", "name" or "created"
   rollup = true               # a Space shows its loudest mark and how many need you
   new-thread = true           # each Space offers a new Thread in it

   [row]
   lines = 3                   # 1, 2 or 3: the built-in layouts below
   hide = []                   # parts to leave out of the layout: "space", "harness", "note", …
   time = "changed"            # "changed": since its state changed; "message": the last message
   # A layout of one's own, part by part; "~" pushes the rest to the right:
   # line1 = ["space", "~", "status"]
   # line2 = ["mark", "title"]
   # line3 = ["note", "~", "harness"]
   ```

   - **States** are the marks seen from the sidebar: `needs` (it asks, or it failed), `done` (it finished while the Person was away), `working` and `idle`. A state listed in neither `states` nor `bottom` goes to the last section, so no Thread is ever hidden.
   - **`attention`** sorts `needs`, then `done`, `working` and `idle`, and the latest change first inside each. It is what ADR 0005 named the attention order.
   - **`group.by = "space"`** makes each Space a section; `states`, `bottom` and `folded` then apply inside each Space, and `folded` may name Spaces too.
   - **A row is one, two or three lines** (_decided_: "how many lines one Thread gets, 1, 2 or 3, and how to show the info"). The line with the title is always the same, the mark and the title, so a Thread looks the same in every density; the other lines add context:

     | `lines` | line 1 | line 2 | line 3 |
     |---|---|---|---|
     | 1 | mark, title ~ space's badge, status | | |
     | 2 | space, harness ~ status | mark, title | |
     | 3 | space ~ status | mark, title | note ~ harness |

   - **The parts.** `mark`: Banda's mark of the Thread's state. `title`. `space`: the Space's coloured badge, with its name when the row has room. `harness`: Claude's or Codex's icon. `status`: "Asks you", "Failed" or "Done" in their colours, the running turn's timer, or the time since the last change. `note`: what it asks, or why it failed, or else the last message. Later: `branch`, `pr`, `diff`.
   - `hide` leaves parts out of the built-in layout; `line1` … `line3` replace it. A row leaves out what its header already says: no Space under a Space's header.
   - A Space's own order (`manual`, by dragging) and the Person's marks (pinned, snoozed, settled; ADR 0005, decision 8) come later, as more values of the same keys: `sort.by = "manual"` and a `pinned` state.

5. **The three presets.**

   | Key | `inbox` (A, T3 Code) | `spaces` (B) | `places` (C, Herdr) |
   |---|---|---|---|
   | `group.by` | `state` | `space` | `state` |
   | `group.states` | needs, done, idle | needs, done, working, idle | needs, done, working, idle |
   | `group.bottom` | working | none | none |
   | `spaces.list` | no | no (the groups are Spaces) | yes |
   | `row.lines` | 3 | 1 | 2 |

   - `inbox` is the default (_decided_ in ADR 0005, decision 8: "those that need the Person" first).
   - In `places`, a click on a Space in the list shows only its Threads, and a second click shows all again, as Herdr's active Space does.

6. **Switching is one click, and it writes the file** (_decided_: "the Person sets it up as they like").
   - The sidebar's header has a view menu, behind a filter icon, with every preset it can find, the Person's own too, and "Edit sidebar.toml" (_decided_).
   - Picking a preset writes `preset = "…"` into the file and keeps the Person's other keys and comments.
   - An Agent changes it the same way, through the sidebar's MCP tools (ADR 0005, decision 14): "group my Threads by Space", "one line per Thread".

7. **A module's file is the engine's, read once for every module.**
   - The engine reads `~/.config/banda/<name>.toml` for any module that declares the file, checks the TOML, and streams its values as JSON: the whole file first, then again on every save.
   - A broken file leaves the last good values in force, and a notice names the file and the line (ADR 0005, decision 11).
   - `config.set` writes keys into the file and keeps the Person's comments. `bandaso check` validates the file.
   - The module that owns the file checks the meaning of its keys against its schema, declared in its manifest (ADR 0005, decision 12). A key it does not know is named in the notice and skipped; the rest still apply.
   - The sidebar is the first module to use it. The look module (ADR 0007, decision 10) uses the same, so there is one way to read, watch and write a config.
   - The file belongs to the machine the window runs on, as the look does.

8. **The arrangement is one pure function.**
   - It takes the Threads of every Space, the Spaces, the Person's seen marks and the settings, and returns the sections, each with its rows.
   - Plain tests cover every preset and every key. The window only draws what it returns.

**Consequences.**

- The engine's Thread list grows what a row needs and the list lacks today: the latest message's first line, why the latest turn failed, and when the running turn began.
- **The design every preset shares**, after T3 Code's: a header with the view menu, a new Space and a new Thread (search comes later, _decided_); the current Thread raised as a card; the shelves at the bottom with their counts; the settings at the foot.
- The sidebar stops drawing one `agents.threads` Pane per Space. It reads the Threads of every Space itself and arranges them, so it can sort across Spaces. The agents module still owns Threads and publishes what happens in them (ADR 0005, decision 8).
- The bar's waiting dot and the workspace marks take the same states, so the sidebar and the bar never disagree.
- Words for `GLOSSARY.md`, once built: preset, section, shelf.
- The order of work, each step its own PR:
  1. **The arrangement and the three presets**, from the built-in defaults, with the preset menu kept in the window until step 2.
  2. **The module's file**: the engine reads, watches and writes `sidebar.toml` and the preset files; the notice for a broken file.
  3. **The MCP tools and the Banda skill's page** on the sidebar's keys, so an Agent can arrange it.
- Later: search; `sort.by = "manual"`; pinned, snoozed and settled; a rail when the sidebar is narrow, as Herdr's.
