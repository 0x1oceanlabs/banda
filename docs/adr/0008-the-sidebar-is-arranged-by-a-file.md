---
status: accepted
date: 2026-11-01
---

# The sidebar is arranged by a file: presets, defaults, and the Person's own keys

ADR 0005 (decision 8) put every Thread of every Space in one sidebar, ordered by what needs the Person, with a switch to group them under their Spaces. On 2026-11-01 Roma saw five ways to arrange it, side by side: A, T3 Code's inbox; B, Threads under their Spaces; C, Herdr's two lists (Spaces, then sessions by priority); D, a hybrid; E, a rail. The research is in the scratch note on both sidebars, read from their source.

Roma liked A, B and C, and asked for one thing instead of three: "unify everything, and change only the sorting and the display. Better, make it hackable: the Person sets it up as they like through a config, and we give only presets and defaults. This is the point of our app: a hackable workspace, and an Agent can set the app up for its Person, as with themes."

**Decision.** Roma decided the points marked _decided_. On 2026-11-01 he accepted the rest as our defaults and asked to build, for now without search and with the presets in the view menu; each stays his to change. The same day he decided the file is the whole interface: no MCP tools and no CLI to set keys (decision 6).

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
   - Any other name is a file: `~/.config/banda/sidebars/<name>.toml`, with the same keys as `sidebar.toml`. A Person can copy one, share one, or ask an Agent to write one. A file named as one of Banda's wins over it, so a Person can copy `inbox` and change it.
   - A preset file cannot name another preset, so there are no chains.

4. **The keys.** Written out with the defaults of the `inbox` preset:

   ```toml
   preset = "inbox"            # "inbox", "spaces", "places", or a file of your own

   [group]
   by = "state"                # "state", "space" or "none"
   states = ["active"]         # the sections, in this order
   bottom = ["working", "settled"]   # shelves at the bottom, each with its count
   folded = ["settled"]        # sections, shelves or Spaces that start folded
   limit = 10                  # rows before "Show more"; 0 shows all
   empty = "hide"              # an empty section: "hide" or "show"

   [sort]
   by = "attention"            # "attention", "changed" or "title"

   [spaces]
   list = false                # a list of Spaces above the Threads, as Herdr's
   order = "changed"           # "changed" or "name"
   rollup = true               # a Space shows its loudest mark and how many need you
   new-thread = true           # each Space offers a new Thread in it

   [row]
   lines = 3                   # 1, 2 or 3: the built-in layouts below
   hide = []                   # parts to leave out of the layout: "space", "harness", "note", …
   # A layout of one's own, part by part; "~" pushes the rest to the right:
   # line1 = ["space", "~", "status"]
   # line2 = ["mark", "title"]
   # line3 = ["note", "~", "harness"]
   ```

   - **States** are where a Thread stands, seen from the sidebar: `active` (neither at work nor settled: it asks, it failed, it finished, or the Person has it in hand; its mark and its status say which, and the section has no heading), `working` (its Agent is at work) and `settled` (put away, as an archive that keeps it at hand). A state listed in neither `states` nor `bottom` goes to the last section, so no Thread is ever hidden.
     - _Changed on 2026-11-01, once Roma had used it._ The states were `needs`, `done`, `working` and `idle`, each a section with its heading ("Needs you", "Done", "Quiet"), and only the working Threads on a shelf. Roma: "Done and Needs you are one place, just different statuses: when the agent has finished I have to go there, see what it wrote and carry the task on"; the old sessions are "settled, like an archive; look at T3 Code and do the same". So the sidebar is T3 Code's: one list with no heading, then the shelves "Working" and "Settled" with their counts, "Settled" folded.
   - **Settled is one of the Person's own marks** (ADR 0005, decision 8), kept by the window as "seen" is, after T3 Code's:
     - The Person settles a Thread from its row's menu (a right click: "Settle thread"), or with `Alt+S` on the Thread they look at; the same un-settles it. A Thread at work, or one that asks, is not settled.
     - A Thread with nothing new for three days settles by itself, unless it asks the Person or they un-settled it since.
     - Anything new in it, a message, a turn that ends, brings it back to the list. Seeing it moves nothing.
   - **`attention`** sorts what waits for the Person first (it asks, it failed, or it finished unseen), then the rest, and the latest change first inside each. It is what ADR 0005 named the attention order.
   - **`group.by = "space"`** makes each Space a section, its rows in `sort.by`'s order; `folded` may name Spaces too.
   - **A row is one, two or three lines** (_decided_: "how many lines one Thread gets, 1, 2 or 3, and how to show the info"). With room, the mark heads the first line by the Space's name and the title stands alone on its own line; the other lines add context:

     | `lines` | line 1 | line 2 | line 3 |
     |---|---|---|---|
     | 1 | mark, title ~ space's badge, status | | |
     | 2 | mark, space ~ status | title ~ harness | |
     | 3 | mark, space ~ status | title | note ~ harness |

   - **The parts.** `mark`: Banda's mark of the Thread's state, with its eyes; green once the Thread is done. `title`. `space`: the Space's name, or its coloured badge in a row of one line. `harness`: Claude's or Codex's logo, as T3 Code shows them, or the name of a Harness with none. `status`: "Asks you", "Failed" or "Done" in their colours, the running turn's timer, or the time since the last change. `note`: what it asks, or why it failed, or else the last message. Later: `branch`, `pr`, `diff`.
     - _Changed on 2026-11-01, once Roma had seen the rows._ The title's line began with the mark, the Space had its badge, and the Harness was named in words. Roma: "two icons" on a line is one too many; "where the Space's name is, the agent's icon", the mark "with the eyes"; "the Thread's name without an icon"; "Claude's logo in the third line, as in T3 Code"; and "when it is done, let's make the agent's icon green".
   - `hide` leaves parts out of the built-in layout; `line1` … `line3` replace it. A row leaves out what its header already says: no Space under a Space's header.
   - A Space's own order (`manual`, by dragging) and the rest of the Person's marks (pinned, snoozed; ADR 0005, decision 8) come later, as more values of the same keys: `sort.by = "manual"` and a `pinned` state.

5. **The three presets.**

   | Key | `inbox` (A, T3 Code) | `spaces` (B) | `places` (C, Herdr) |
   |---|---|---|---|
   | `group.by` | `state` | `space` | `state` |
   | `group.states` | active | active, working, settled | active, working, settled |
   | `group.bottom` | working, settled | none | none |
   | `spaces.list` | no | no (the groups are Spaces) | yes |
   | `row.lines` | 3 | 1 | 2 |

   - `inbox` is the default (_decided_ in ADR 0005, decision 8: "those that need the Person" first).
   - In `places`, a click on a Space in the list shows only its Threads, and a second click shows all again, as Herdr's active Space does.

6. **Switching is one click, and it writes the file; the file is the whole interface** (_decided_: "the Person sets it up as they like"; and, asked whether it needs MCP tools, a CLI or only the file: "the config file, then").
   - The sidebar's header has a view menu, behind a filter icon, with every preset it can find, the Person's own too, and "Edit sidebar.toml" (_decided_). That opens the file in the Person's editor, from Banda's template when it is not there yet: the preset, and every other key with its default, commented out.
   - Picking a preset writes `preset = "…"` into the file and keeps the Person's other keys and comments. A file that is a link stays one.
   - An Agent changes it the same way: it edits the file with its own tools, and `banda look check` tells it whether the file is right. No MCP tool and no CLI command sets a key; they would only repeat the file. The Banda skill's reference (ADR 0005, decision 14) will describe the keys when there is one.

7. **The file is read with the look's.** _Changed on 2026-11-01, when it was built. This decision first had the engine read a config file for any module. The look had by then shipped without the engine (ADR 0007, decision 10), and the sidebar's file is this machine's as the look's is, so it joined the look._
   - `banda look` resolves `sidebar.toml` with `look.toml`, and `banda look --follow` prints the arrangement again on every save of either file, of the preset file in force, or of the Person's presets folder. The window applies it as it applies the look.
   - A broken file leaves the last good arrangement in force, and the bar names the file and the line, as it does for the look (ADR 0005, decision 11). A wrong value of `row.lines`, a preset file that names a preset, and an unknown preset are named and left out, and the rest still applies.
   - `banda look check` checks `sidebar.toml` and any file in a `sidebars` folder; with no files it checks every file the look and the sidebar read.
   - A config file the engine reads for any module waits until a module that runs in the engine needs one.

8. **The arrangement is one pure function.**
   - It takes the Threads of every Space, the Spaces, the Person's seen marks and the settings, and returns the sections, each with its rows.
   - Plain tests cover every preset and every key. The window only draws what it returns.

**Consequences.**

- The engine's Thread list grows what a row needs and the list lacks today: the latest message's first line, why the latest turn failed, and when the running turn began.
- **The design every preset shares**, after T3 Code's: a header with the view menu, a new Space and a new Thread (search comes later, _decided_; _changed on 2026-11-01 by ADR 0017_: the header opens with the Banda menu's "Search" field, and the view menu is its filter icon alone, the preset named only in its tooltip); the current Thread raised as a card; the shelves at the bottom with their counts; the settings at the foot.
- The sidebar stops drawing one `agents.threads` Pane per Space. It reads the Threads of every Space itself and arranges them, so it can sort across Spaces. The agents module still owns Threads and publishes what happens in them (ADR 0005, decision 8).
- The bar's waiting dot and the workspace marks take the same states, so the sidebar and the bar never disagree.
- Words for `GLOSSARY.md`, once built: preset, section, shelf.
- The order of work, each step its own PR:
  1. **The arrangement and the three presets**, from the built-in defaults, with the preset menu kept in the window until step 2. _Done._
  2. **The file**: `banda look` reads and watches `sidebar.toml` and the preset files; the view menu writes the preset; "Edit sidebar.toml"; the notice for a broken file. _Done._
- Later: the keys in the Banda skill's reference, once there is one; search; `sort.by = "manual"`; pinned and snoozed; a rail when the sidebar is narrow, as Herdr's.
