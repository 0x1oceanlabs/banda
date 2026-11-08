---
status: accepted
date: 2026-11-05
---

# A Space is called a Project, and the Person archives a Thread

ADR 0026 took T3 Code's way of adding a folder and kept one word of our
own: "The labels are T3 Code's, with Space for project." The GLOSSARY
says "_Avoid_: project". ADR 0046 called a Thread without one "No Space".

The people who tried Banda say the word misleads them. It is easy to see
why:

- In a tiling window manager (AeroSpace, yabai) and on macOS, a space is
  a virtual desktop. Banda is a tiling workspace, and its Persons come
  from those.
- Banda has workspaces too, screens of Panes, and since ADR 0065 a Space
  has a workspace of its own. "A Space's workspace" reads as one thing
  said twice.
- T3 Code, Conductor, Cursor and Zed all say project for the same thing:
  a folder that the work happens in.

The sidebar's shelf "Settled" (ADR 0008, decision 4) is T3 Code's word
too, and it says little. A Thread there is put away and comes back when
something new happens in it. That is Gmail's archive. A Thread also
settled by itself after three quiet days, which moves rows that the
Person did not move.

Roma, on 2026-11-05: rename Space to Project, with "No project" for the
Threads without one; give a Project an icon or a short sign; and call
Settled "Archive". Then, on the proposals:

- "1 да все меняем": the code, the contract and the data change too, not
  only the window.
- "4 давай пока только вручную": only the Person archives.
- An icon, found by itself and picked by hand, with its look still to be
  worked out. That is its own ADR, after a mock.
- A Project kept in a container is a later step with its own design,
  together with the browser's profiles.

## Decision

Roma decided the points marked _decided_ on 2026-11-05. The rest are our
defaults and stay his to change.

1. **The word is Project** (_decided_).
   - The window says it wherever it said Space: "Add Project", the source
     "New Project" ("Start a new Project from a name"), "Project
     settings", "Remove Project", "Make a Project from it…", the New
     Thread picker, the settings' "Projects", a Project's workspace.
   - The Threads without one are in **No Project**, as T3 Code's are in
     "No project". The scratch folders do not change:
     `~/Banda/scratch/<date>-<id8>/` (ADR 0046).
   - A new Project's folder is still `~/Banda/<name>/`.
   - The GLOSSARY's entry is **Project**, and it avoids space. The ADRs
     before this one keep their word: they are history, and this ADR is
     the key to them.
   - Workspace keeps its word: one screen of Panes.

2. **The code says it too** (_decided_).
   - Rust and TypeScript: `Space` → `Project`, `SpaceId` → `ProjectId`,
     `ModuleSpace` → `ModuleProject`, `Scope::Space` → `Scope::Project`,
     `Place::Space` → `Place::Project`, and the files named for it
     (`kernel/src/space.rs`, `SpacesSettings.tsx`, …).
   - The methods: `spaces.*` → `projects.*` (`projects.list`,
     `projects.add`, `projects.update`, `projects.tools`, …).
   - The CLI: `banda project add`, and `--project` for `--space`.
   - An Agent's environment: `BANDA_PROJECT` for `BANDA_SPACE`.
   - The Banda menu's routes: `project.add` and `project.<name>`.
   - The sidebar's file: the preset `projects`, `group.by = "project"`,
     the table `[projects]` and the row's part `project`.
   - Space the key stays a key: `Alt+Space`, `Space` in `keys.toml`. So do
     `whitespace`, `namespace` and the like, which are other words.

3. **Nothing written before is lost.**
   - **The engine's data** moves once, as the engine starts:
     `spaces/` becomes `projects/` and each `space.json` becomes
     `project.json`, by a rename on the same disk, whole or not at all,
     as ADR 0026 (decision 2) moved `.banda/`. A move that failed leaves
     everything as it was and is tried again on the next start.
   - **What a log or a file already holds is read in both names, for
     good.** A field `space` in an event, in the machine's log (a Pane's
     `space`, `Place::Space`) and in an old `project.json` reads as
     `project`. New records are written in the new name. No log is
     rewritten.
   - **What a Person or an Agent types gets one stable release of grace.**
     The methods `spaces.*` answer as `projects.*`. `banda space add` and
     `--space` still work. `BANDA_SPACE` is set beside `BANDA_PROJECT`.
     `sidebar.toml` reads its old keys and values as the new ones, and
     `banda look check` says what each is called now. They go with the
     stable release after the one that ships this.
   - **What the window keeps** under a key with space in its name is read
     there once and written under the new key.
   - **What Banda shares** (ADR 0039): the usage summary's count of
     `spaces` is called `projects`.

4. **Settled is called Archive** (_decided_).
   - The shelf is "Archive", folded as before. The row's menu says
     "Archive thread" and "Unarchive thread". `Alt+S` stays its key.
   - The state is `archived` in `sidebar.toml`. `settled` is read as it,
     with the same grace as decision 3.
   - Everything else is as ADR 0008 has it. Anything new in a Thread, a
     message or a turn that ends, brings it back to the list, as a reply
     brings a letter back in Gmail. Seeing it moves nothing. Archiving
     closes the Panes that show it. A Thread at work, or one that asks,
     cannot be archived.

5. **Only the Person archives** (_decided_).
   - The three quiet days go: a Thread is never archived by itself.
   - The first time a window with this starts, every Thread that the
     three days had archived is archived by the Person's hand, written
     once. Nothing comes back into the list just because the rule is
     gone.
   - _Changed on 2026-11-08, by ADR 0096._ The archive is kept on the
     Thread by its host. Each machine's window sends what its cutoff
     archives to the host once, as archives of their own, and the
     window's cutoff goes.

6. **A Project's own Archive keeps its word** (ADR 0026). It hides the
   Project from the pickers and keeps everything. It never comes back by
   itself, as a Thread does. Both are "put away, and nothing is lost".

7. **Not here.**
   - **A Project's icon** (_decided_: found by itself, from the
     Project's favicon or logo, and picked by hand). Its look and where it
     shows wait for a mock, then their own ADR. A Project's colour must
     stay quiet: colour already says what an Agent is doing (ADR 0065).
   - **A Project kept in a container** (_decided_: later). Its own design
     comes later, with how the browser's profiles work.

## Consequences

- The window, the Banda skill, `docs/architecture.md` and the GLOSSARY
  say Project. The kernel, every module and the contract say it too.
- Old engine data, an old window's marks and an old `sidebar.toml` keep
  working. Only scripts and Agents' notes that call `spaces.*` or read
  `BANDA_SPACE` have to change, within one release.
- The rename in the code is one PR that touches most packages. It lands
  when few PRs are open, and its description carries the commands that
  rename a branch, so an open PR can take it in.
- Threads that the three days used to archive now stay in the list
  until the Person archives them. The ones already archived stay
  archived.
- The ADRs before this one say Space. Read it as Project.

## Steps

1. **This ADR and the GLOSSARY.**
2. **Archive** in the window: the shelf, the menu, the state in
   `sidebar.toml` with `settled` read as it, no three days, and the
   one-time write (decisions 4–6).
3. **Project in the window's words**, the Banda skill and
   `docs/architecture.md` (decision 1).
4. **Project in the code**, the contract, the CLI, the engine's data and
   the sidebar's file, with the old names read (decisions 2 and 3).

Then the icon's mock and its ADR.
