---
status: accepted
date: 2026-11-01
---

# Alt+Space opens the Banda menu: one place to find and run everything

Several ADRs promise a palette, and none has built it:

- **ADR 0005** promised one on `Alt+Space`: "every action, each with its key", built from the modules' manifests (decisions 2, 10 and 12). It also promised a key sheet on `Alt+K`.
- **ADR 0008** left search out of the sidebar "for later".
- **ADR 0016** opens settings "from the palette".

Roma, on 2026-11-01, looking at the sidebar's header:

> let's make the filter just an icon, and on the left there will be our spotlight; we still need to think up a name for it; it opens on Alt+Space, and through it you can launch everything, like the menu in Omarchy
>
> in essence it will be our Raycast

**What others do.** Read on 2026-11-01:

- **Omarchy's menu (`Super+Space`).**
  - It is one tree in `omarchy-menu.jsonc`. The ids are dotted (`appearance.theme`), and a dotted id belongs under its parent.
  - The root holds Apps, Learn, Appearance, Trigger, Setup, Install, Remove, Update, About and System.
  - Enter goes into a branch, and the search runs over every leaf.
  - `omarchy menu summon <route>` opens it at a branch, so a key or a script can go straight there.
- **Raycast.**
  - One window in the middle of the screen. Empty, it shows suggestions and favourites.
  - Its results come from extensions.
  - `⌘K` opens what can be done with the selected row.
  - When nothing matches, its fallback rows (search the web, ask AI) still run the words.
- **T3 Code's command palette.**
  - Its placeholder: "Search commands, projects, and threads...".
  - Its groups: Actions, Recent Threads, Threads, Projects, Settings and Suggestions.
  - Its footer: "↑↓ Navigate · Enter · Backspace Back · Esc".
  - The sidebar's header holds a Search field, "Add project" and "New thread".

**Decision.**

1. **It is the Banda menu, on `Alt+Space`, inside Banda** (_decided_).
   - It is named as Omarchy's menu is named.
   - It opens over Banda's window, not over the whole desktop.
   - A later `banda menu [route]` lets the Person bind it in Hyprland as `omarchy menu` is bound, if they want it everywhere.

2. **One window in the middle, as Raycast's.**
   - It sits in the upper third of Banda's window, and dims what lies behind it.
   - Only one is open at a time.
   - Esc or a click outside closes it.
   - It always opens empty, at its root.

3. **The sidebar's header opens it** (_decided_).
   - On the left is a field that reads "Search" with `Alt Space` beside it. It is a button: a click opens the same menu. There is one search, and it works the same from everywhere.
   - Then come three icons:
     - the view menu's filter icon alone, with the preset's name only in its tooltip ("just an icon", _decided_);
     - a new Space;
     - a new Thread.

4. **Empty, it shows what comes next.**
   - **Recent Threads**, in the sidebar's order: what waits for the Person first, each with its mark.
   - **Actions**: the ones the Person runs most, each with its key.

5. **Typed into, it searches everything at once**, in one list of groups:
   - **Threads**: by title, then by the words in their messages.
   - **Spaces.**
   - **Files** of the focused Space, as `@` finds them in the composer.
   - **Actions**: every action, each with its key, so the menu teaches the keys.
   - **Settings**: the rows of ADR 0016's window.
   - **Last, always, the fallback rows:**
     - "New Thread: «the words»" on the first Harness, with its logo;
     - "Open" for a URL, or "Search the web" for the words.
   - **The order.** A better match ranks first. Among equal matches, what the Person opens often and lately ranks first. Groups keep the order above.

6. **The keys inside it.**
   - `↑` `↓` choose a row, and `Enter` opens or runs it.
   - `Shift+Enter` opens it beside, in a new column.
   - `Alt+Enter` starts a new Thread with the words, whatever row is chosen. So `Alt+Space`, a task, `Alt+Enter` sets an Agent to work.
   - `Tab` shows what can be done with the row: Open, Open beside, Settle thread, Rename… This is Raycast's `⌘K`; `Alt+K` stays Banda's own.
   - `Backspace` in an empty field goes back up a level.
   - `Esc` closes the action list, then the menu.
   - The footer names these keys, as T3 Code's does.

7. **A tree, as Omarchy's.**
   - A row can hold more rows: Settings → Look → Theme; a Space → its Threads and actions; "New Thread" → the Harnesses.
   - `Enter` goes in, and the path shows as chips in the field.
   - Every row has a dotted id, such as `settings.look.theme`. That id is the route `banda menu` will open.

8. **Modules fill it; the menu knows none of them.**
   - **Its rows come from two places:**
     - the one list of actions (ADR 0005, decision 2);
     - the sources each module declares in its manifest (ADR 0005, decision 12). The agents module gives Threads, the browser its tabs and history, the git modules branches and PRs, and settings its rows.
   - This is Raycast's extensions, built on the contract every module gets.
   - Until the manifests come (ADR 0014), the window's own list of actions and the sidebar's Threads feed it.

9. **The key sheet is the Banda menu opened at Actions.**
   - `Alt+K` opens it there, so there is one list of keys, not two.
   - (_built_ 2026-11-02) Empty, it lists every action under its section (Threads, Panes, Columns, Workspaces, Banda), each with all its keys; a key from `keys.toml` is outlined and names its line. A family of actions, as Focus a Pane on the four arrows or Go to a workspace on 1–9, is one row the menu goes into; a search finds each one.
   - `Tab` on an action runs it, adds a key or frees one of its keys. Add a key waits for the next key pressed, Alt+K too, and writes it to `keys.toml` through `banda settings set` (ADR 0005, decision 11); the line under the field says what changed, or why a key is refused.

10. **It looks like the mockup Roma saw**, `docs/adr/0017-banda-menu.html`.
    - It uses `@banda/ui` and the theme's tokens, as every Pane does.

**Consequences.**

- **ADR 0005 changes:** `Alt+Space` is the Banda menu, and `Alt+K` opens it at Actions.
- **ADR 0008 changes:** search comes into the header as the Banda menu's field, and the filter is an icon alone.
- **ADR 0016 changes:** settings open from the Banda menu.
- Words for `GLOSSARY.md`, once built: the Banda menu, a source, a fallback row.
- The order of work, each step its own PR:
  1. This ADR, with the mockup.
  2. **The menu:**
     - `Alt+Space` and the sidebar's field; the filter as an icon;
     - Actions with their keys, Recent Threads, Threads and Spaces;
     - "New Thread: «the words»" and `Alt+Enter`;
     - `Alt+K` at Actions.

     _Done._
  3. **The tree and the action list:** branches, chips, `Backspace` and `Tab`. Settings join once ADR 0016's window has its rows.
     - _Done_ with `Shift+Enter`, a Space and the sidebar's view as branches, and the Harnesses under `Tab` on "New Thread". Settings wait for that window.
  4. **More rows:** Files of the focused Space; the browser's "Open" and "Search the web"; ranking by what is opened often and lately.
     - _Done._ A file opens in a browser, and `Tab` offers Copy path. What is chosen is kept in the window's storage, its count weighed by how lately: among equal matches it ranks first, and it leads the empty menu's Actions.
  5. **Sources from the manifests**, with ADR 0014.
     - _Changed on 2026-11-02:_ this is ADR 0022's step 4, where a module's `defineModule` declares its sources.
  6. **`banda menu [route]`.**
     - _Done._ The CLI writes one JSON line to the window's socket, `window.sock` in the state folder, and the window answers `ok`. The engine names that path to the window as it starts, so both find it the same way. Routes: `actions`, `views`, `space.<name>` (or its ID), and `settings.<section>.<row>` for the settings window; other words open the menu with them typed in. Dotted ids for every row wait for the manifests (step 5).
