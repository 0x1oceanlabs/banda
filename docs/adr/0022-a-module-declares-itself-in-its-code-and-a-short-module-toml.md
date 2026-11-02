---
status: accepted
date: 2026-11-02
---

# A module declares itself in its code and a short module.toml

ADR 0005 (decision 12) gave every module a `module.toml`. It would
declare the module's Panes, actions, commands, events, tables, MCP tools
and settings schema, and the window's registries, the palette, the key
sheet and the skill's reference would all be built from it. None of that
is built. Today what a module offers is listed by hand, in the places
that use it:

- `app/web/src/registry.tsx` imports each module's Panes and Watches by
  name.
- The window's `shell/actions.ts` holds actions that belong to modules,
  such as New browser and New Thread, and imports `threadPane` and
  `NEW_THREAD` from the agents module.
- The Banda menu knows the agents module itself: it reads Threads from
  the sidebar's lists and asks `agents.files` for files (ADR 0017,
  decision 8 says it should know none).
- `banda_settings::FILES` lists the settings files.

Half of what ADR 0005 put in `module.toml` is already declared in code,
typed, once:

- a method, its right, whether it reads or commands, its params and its
  answer, in the module's `methods!` table (ADR 0014), with its tool mark
  (ADR 0019) and its tables in `Module::migrations`;
- a Pane, its args, title and icon, with `definePane`.

A `module.toml` that named them again would be a second copy that drifts
from the first. Roma chose to declare in code what is code, and to keep
`module.toml` for the rest ("б да через манифест", 2026-11-02).

**Decision.**

1. **A module's manifest is its code, where that is code, and a short
   `module.toml`.**
   - **The engine part:** the `Module` it gives the kernel, with its
     `methods!` table. That is its methods, rights, tools, events and
     tables (ADR 0014, ADR 0019). Nothing about them goes into the TOML.
   - **The window part:** one `defineModule({…})` exported from the
     module's Pane package, from `@banda/ui/module`. It names the module's
     id and its Panes, actions, Watches and menu sources (decision 4).
     It is typed: a wrong field fails `tsc`.
   - **`module.toml`**, at the module's root (`modules/<id>/module.toml`),
     holds only what no code says:
     - its id, name, a line of what it is, and its version;
     - whether it comes from Banda;
     - the settings files it owns, by name (`browser.toml`);
     - its unstable marks (decision 6).
   - Its skill topics stay in its `skill/` folder, found as ADR 0012 has
     it.
   - **`banda modules` prints the three as one JSON per module**: what a
     module offers, for a Person, an Agent and the skill's reference.

2. **The window knows no module.**
   - One file, `app/web/src/modules.ts`, lists the window parts of the
     modules, by a static import each. It is the one place that names
     them.
   - The Pane registry, the Watches, the actions, the key sheet and the
     Banda menu's sources are built from that list.
   - The window's own things are a module too, `window`: the launcher, the
     workspace and column actions, Spaces as a source. It is declared the
     same way.
   - An architecture test fails when any other file of the window imports
     a module's package.

3. **An action belongs to its module.**
   - New browser moves to the browser module; New Thread and the menu's
     "New Thread: «the words»" to the agents module.
   - An action keeps the id it has, so lines of `keys.toml` stay right. A
     new action's id starts with its module's id. Ids are unique across
     modules, and a test says so.
   - An action names its section and family for the key sheet (ADR 0017,
     decision 9) and its keys; `keys.toml` binds more by its id (ADR 0005,
     decision 11).
   - What an action does in the window (open a Pane beside, focus one,
     close one), it asks of the window API it is given. That API moves
     into `@banda/ui`, as the part of the contract a module's window part
     gets. What a module needs that the API lacks is added there, not
     reached around.

4. **A source gives the Banda menu its rows** (ADR 0017, decision 8).
   - A source has an id, a group heading, and `find(words, here)`: the
     rows that fit the words, now or later. `here` is the focused Space
     and the engine.
   - A row has a dotted id (`agents.thread.<id>`, `settings.look.theme`),
     a title, an icon, a detail, its keys, what `Enter` does, the acts
     `Tab` lists, and, for a branch, the rows inside it.
   - The dotted id is the route `banda menu` opens (ADR 0017, decision 7).
   - The menu keeps what is its own: the field, the keys, the groups'
     order, the ranking and what is opened often and lately. It knows no
     module.
   - The sources there will be:
     - agents: Threads, and the focused Space's files;
     - window: Spaces, the actions, the sidebar's view;
     - settings: the rows of ADR 0016's window, once it has them;
     - browser: its tabs and history, later (see the order of work).
   - _Changed on 2026-11-02, in step 4:_
     - A source is drawn as a Watch is: its `Find` component says its
       rows, now or later, while the engine runs its module. A hook in a
       loop could not stop as a module stops.
     - The Threads stay the window's: they are the sidebar's lists, which
       any module's Watch fills, and they open, open beside and settle as
       the sidebar does. The agents module gives New Thread with the
       words (and, by `Tab`, on each Harness) and the files. The browser
       gives the words as a page.
     - A module's row has a dotted id. The window's rows keep the ids the
       menu has counted as opened (`thread:…`, `space:…`, `action:…`).
       The routes stay the branches' (`actions`, `views`,
       `space.<name>`): no source has a branch yet.
     - `Tab` on a Space opens it or starts a new Thread there; the choice
       of a Harness is inside it, on its New Thread.

5. **One id is the module everywhere.** The engine's `Module::name`, the
   window's `defineModule` id and `module.toml`'s id are the same word. A
   module's Panes, Watches and sources run only while the engine runs it,
   as `useModules` already decides. A module with no engine part, such as
   the browser, is always on.

6. **What is not in the contract yet is marked, and the marks are
   counted** (ADR 0005, decision 12).
   - The rule stays: a module of ours takes no path that a module from
     elsewhere lacks. Where one does today, its `module.toml` names it in
     an `[unstable]` table, with why:

     ```toml
     [unstable]
     desktop-main = "pages live in the window's main process (ADR 0013); no contract for it yet"
     ```

   - `banda modules` counts the marks, and `scripts/check.sh` prints the
     count. A test holds a ceiling: a mark with no reason, or one over the
     ceiling, fails. A PR that raises the ceiling says so.
   - A path that gets its place in the contract loses its mark, and the
     count falls.
   - The first marks: the browser's code in the window's main process,
     and whatever the window API lacks when step 3 moves the actions.

7. **Not now.**
   - Modules from elsewhere: a process that speaks the engine API,
     installing one, loading its window part, marking it as not from
     Banda. ADR 0001 (decision 10) puts them after our base; this ADR
     shapes what they will get.
   - Loading window parts at run time. Ours are imported when the window
     is built.

**Consequences.**

- **ADR 0005, decision 12, changes:** `module.toml` holds only what the
  code does not say; the rest is declared in code, once.
- **ADR 0017, step 5** ("sources from the manifests") is this ADR's
  step 4.
- ADR 0005's architecture test "registries come only from manifests"
  becomes decision 2's test.
- Words for `GLOSSARY.md`: module, manifest, source, unstable mark.
- The order of work, each step its own PR:
  1. This ADR.
  2. `defineModule` and `modules.ts`: the Panes and Watches come from the
     modules, with the architecture test.
     - _Done._ A Pane or Watch no longer names its engine module: its
       module's `engine` says whether it needs one. The architecture test
       lists the files that still reach a module, each with the step that
       ends it, and fails once one no longer does.
  3. The actions move to their modules; the window API moves into
     `@banda/ui`; the window stops importing modules.
     - _Done._ New Thread is the agents module's and New browser the
       browser's, with the ids and keys they had. `Action` and the window
       API (`WindowApi`: the home Space, and opening a Pane right of the
       focused one) are `@banda/ui/module`'s. An action names its key
       sheet section. The sidebar's and the menu's new Thread run
       `thread.new` by its id, with the Space, the words and the Harness
       as its args. The window's own actions take more of the window than
       the API gives, so they stay in `shell/actions.ts`, and the list
       there is the modules' actions, then the window's. The Banda menu
       still reaches the agents and browser modules, until step 4.
  4. Sources: the Banda menu's Threads, files, Spaces and actions come
     from sources, with dotted ids as routes.
     - _Done._ `defineModule` takes `sources`; `@banda/ui/module` has
       `Source`, `MenuRow` and `MenuAct`. The window API runs an action
       by its id (`run`), so the agents module's files open through
       `browser.open`, an action run by its id alone (`unlisted`). The
       Banda menu imports no module; the architecture test's list holds
       the settings window's agents section and the browser's main
       process alone.
  5. `module.toml` for each module, `banda modules`, the unstable marks
     counted against a ceiling; the skill's reference lists the modules,
     their actions and their tools from it.
     - _Done._ agents, terminal and browser each have a `module.toml`.
       The `methods!` table also gives `method_list()`. The engine has no
       window, so the window's tests copy each `defineModule` into
       `window.json` beside the `module.toml`, and fail while it was
       stale, as `cargo test` does the types. `banda modules` puts the
       three together (`--unstable`: the marks and the ceiling); the
       engine's tests write the skill's `modules` topic from it. The two
       marks are the agents module's settings section and the browser's
       main process; the architecture test's list names them, and the
       ceiling is 2 and only falls. The window's own actions are the key
       sheet's, not a module's, so the topic leaves them out.
  - **Later, not forgotten:**
    - the browser's tabs and history as a source of the Banda menu;
    - the settings window's rows as a source, once ADR 0016 has them.
