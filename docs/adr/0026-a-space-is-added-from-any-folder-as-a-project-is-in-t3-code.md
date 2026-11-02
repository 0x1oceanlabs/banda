---
status: accepted
date: 2026-11-02
---

# A Space is added from any folder, as a project is in T3 Code

ADR 0005 (decision 6) decided that a Space is any folder on a machine, a
git repository too, that `~/Banda/<name>/` stays the default place for a
new one, and that Banda keeps its data outside the folder, in the
engine's data on that machine, as T3 Code and Herdr do. None of it is
built. Today:

- The only way in is the sidebar's "New Space": a dialog with one field,
  "Name", which makes an empty `~/Banda/<name>/` (`spaces.create`).
- The engine finds the Spaces by reading `~/Banda`; a folder elsewhere is
  never seen.
- The data lives in the folder's `.banda/`: the manifest, the SQLite, the
  lock, the images, the files a message keeps (ADR 0015, decision 5) and
  the old Agents' settings.
- A Space cannot be renamed, pinned, archived or removed, and the window
  has no way to pick a folder.

Roma, on 2026-11-02: "what is missing for adding a directory as a Space?
Look how T3 does it; we need a menu like theirs, they call it a project."
After the list of what T3 Code does and what Banda lacks, Roma agreed to
every proposal:

- Remove works as in T3 Code: it forgets the Space and deletes its
  Threads, after a confirmation; the files are not touched. Archive is
  the gentle way, which keeps everything.
- The existing Spaces move their data out of `.banda/` by themselves, the
  first time the new engine starts.
- Cloning from a Git URL comes later, as its own step.
- The labels are T3 Code's, with Space for project.

**What T3 Code does** (its source, commit `1d626d0`, 2026-11-01):

- Every way in opens one view of the command palette, "Add project": the
  sidebar's folder icon, the empty states ("No projects yet", "What
  should we work on?"), the last row of the new thread's project picker,
  and the palette's own action. There is no dialog and no key of its own.
- That view lists the sources: "New project" ("Start a new Git
  repository from a name"), "Local folder" ("Browse a folder on disk"),
  "Git URL" ("Clone from a remote URL") and a provider's repositories.
- "Local folder" is a path field, "Enter project path (e.g.
  ~/projects/my-app)", that starts in a base folder and lists the
  subfolders of what is typed (`filesystem.browse`): folders only, dot
  folders only once a dot is typed, a row to go up. Its button is "Add",
  or "Create & Add" when the folder does not exist ("Press Enter to create
  this folder and add it as a project."). On the desktop, a button at the
  foot opens the system's folder picker.
- The title is the folder's name; a new thread opens at once. A folder
  that already is a project is not an error: that project opens.
- A project's row has "New thread", "Copy path", "Pin project" and
  "Project settings". The settings hold "Name", "Project icon", "Pin"
  ("Pinned projects come first in project pickers."), "Archive" ("Hides
  the project from project pickers. Threads and files are kept.") and,
  under "Danger", "Remove project" ("Deletes the project entry and its
  threads. Files on disk are not touched."), which asks first.

**Decision.**

1. **A Space's data lives in the engine's data, not in its folder**
   (ADR 0005, decision 6, as built).
   - A new place, data, `~/.local/share/banda` (`BANDA_DATA` moves it, as
     `BANDA_ROOT`, `BANDA_STATE` and `BANDA_CONFIG` move theirs). Each
     Space has `spaces/<id>/` there: `space.json`, the SQLite, the lock,
     `images/`, `files/` and `agents/`.
   - `space.json` names the folder, by its absolute path. The engine
     opens the Spaces it finds under `spaces/`; it no longer reads
     `~/Banda` for them. `~/Banda` is only where "New Space" puts a new
     folder.
   - The folder holds the work alone. Nothing of Banda's is committed by
     mistake, and nothing a sync tool can break.
   - **The files a message keeps** (a dropped file, a long paste) go to
     `spaces/<id>/files/<ID>/<name>`, and the message names them by that
     path, outside the folder. Each Thread's session gets that folder as
     an extra root (ACP's `additionalDirectories`), so its Agent reads
     them as it reads the Space's own files. Where a Harness does not
     take extra roots, its Agent asks before it reads one, as for any
     file outside its folder.
   - The files list and `@` search no longer skip `.banda/`: there is
     none.

2. **The existing Spaces move by themselves.** On start, the engine looks
   once in `~/Banda/*/.banda/space.json` for Spaces it does not know yet,
   moves each one's `.banda/` into `spaces/<id>/`, writes the folder into
   `space.json`, and removes the empty `.banda/`.
   - A move is whole or not at all: the files are copied, the copy is
     made the Space's by renaming it into place, and only then is
     `.banda/` removed. A move that failed leaves `.banda/` as it was and
     tries again on the next start.
   - The Threads' past messages name kept files by their old
     `.banda/files/…` path. Nothing in Banda opens such a path: only an
     old Thread's Agent, reading it again, finds it gone, and a new
     message names the file anew.
     _Changed on 2026-11-02, in step 2:_ the first text said the window
     and the engine would read the old paths from the data; nothing does.
   - Two Spaces that name one folder: the first opens, the second stays
     closed and is logged.

3. **Adding a Space is one branch of the Banda menu, "Add Space"**
   (ADR 0017), as adding a project is one view of T3 Code's palette.
   - Its sources:
     - **"New Space"**, "Start a new Space from a name": a name, and the
       folder `~/Banda/<name>/` is made.
     - **"Local folder"**, "Browse a folder on disk": the path field, its
       placeholder "Enter Space path (e.g. ~/code/my-app)". It starts at
       `~/`, lists the subfolders of what is typed as T3 Code does, and
       has a row to go up. Enter adds the folder ("Add"), or makes it
       and adds it when it does not exist ("Create & Add"). A button at
       its foot opens the system's folder picker (Electron's
       `showOpenDialog`, which the desktop portal draws on Hyprland).
     - **"Git URL"**, "Clone from a remote URL": decision 7.
   - Every way in opens this branch, at route `space.add`: the sidebar's
     folder button, renamed "Add Space"; the empty states; an "Add Space"
     row at the end of the Space list in "New Thread"; the menu's
     Actions; and `banda menu space.add`.
   - The first screen, "Create your first Space", offers "Add Space"
     beside the name, so a Person with their work already in a folder
     starts there.
   - A Space's name is the folder's name; the Person can change it later.
     Once added, the Space's new Thread opens, as in T3 Code.
   - A folder that already is a Space is not an error: that Space opens.
     If it was archived, it comes back first.
   - `banda space add <path> [--name]` does the same from a terminal.
   - _Built on 2026-11-02, in step 4:_
     - The first screen offers the two ways as tabs, "New Space" and
       "Local folder".
     - A Space added elsewhere, as by `banda space add`, shows once the
       window comes to the front: it reads the Spaces again then.
     - The window already lists pinned Spaces first and leaves out
       archived ones, though only step 6 lets a Person pin or archive.
     - A Pane runs "Add Space" through `PaneProps.run`, as a module's
       action runs through `WindowApi.run`: so does "New Thread"'s
       Space list.
     - The menu's "Add Space" branch shows in its Actions and in the key
       sheet's "Banda" section.
   - _Built on 2026-11-02, in step 5:_
     - The button is T3 Code's "Open in Files", in the menu's foot and
       beside "Add" on the first screen. The picker opens at the folder
       of what is typed, and the folder picked is added at once, as in
       T3 Code.

4. **The engine's methods.**
   - `spaces.add {folder, name?, create?}`: adds the folder as a Space.
     The folder must exist and be a folder, unless `create` makes it.
     The path is made absolute and its links resolved, so one folder is
     never two Spaces: the same folder again answers the Space it
     already is. The refusals name the folder: it does not exist, it is
     not a folder.
   - `spaces.create {name}` stays, as "New Space": `spaces.add` of
     `~/Banda/<name>` with `create`.
   - `spaces.browse {partial}`: the subfolders that match what is typed,
     for the path field. Only the owner may call it (ADR 0019): an
     Agent's pass, held to its own Space, is refused.
   - `spaces.update {space, name?, pinned?, archived?}` and
     `spaces.remove {space}`.
   - `SpaceSummary` gains `pinned`, `archived` and `missing` (decision 6).
     _Changed on 2026-11-02, in step 3:_ `missing` comes with step 7,
     which lists a Space whose folder is gone; until then the engine
     lists no such Space.

5. **A Space is managed where it is shown, with T3 Code's words.**
   - A Space's row in the sidebar has a right-click menu: "New Thread",
     "Copy path", "Pin Space" or "Unpin Space", "Space settings".
   - The settings Pane (ADR 0016) gets a "Spaces" section. It is the
     engine's data, not a file, so it calls the engine as the Agents
     section does. Per Space: "Name"; "Pin" ("Pinned Spaces come first in
     Space pickers."); "Archive" ("Hides the Space from Space pickers.
     Threads and files are kept."); and, under "Danger", "Remove Space"
     ("Deletes the Space entry and its Threads. Files on disk are not
     touched.").
   - Remove asks first: `Remove Space "{name}" and delete its N Threads?`,
     the path, "This removes only the Space entries, not the files on
     disk." and "This action cannot be undone." It then deletes
     `spaces/<id>/` once the Space's turns and terminals have stopped.
   - Pinned Spaces come first in the sidebar's Space list, the Banda
     menu's Spaces and "New Thread"'s list; archived ones are in none of
     them, only in the settings, where they can come back.
   - _Built on 2026-11-02, in step 6:_
     - The menu is on a Space's row wherever the sidebar shows one: the
       "places" view's Space list and a Space's section header.
     - The "Spaces" section picks one Space at a time, as T3 Code's
       project settings do; `spaces/<id>` links to it. An archived Space
       says so in the picker.
     - Remove asks in a dialog of the window's. The Threads it counts
       are the agents module's (`agents.threads`): the window calls a
       module by name there, around ADR 0022, until a module can say
       what goes with a Space.
     - Every list of the Spaces in the window (`useSpaces`) reads them
       again once one is changed here, so the sidebar, the settings and
       "New Thread" follow at once. The engine has no event for it yet,
       so a change made elsewhere shows as the window comes to the
       front.
     - "Copy path" needed the page to write to the clipboard: the window
       now grants it that one permission, and still not reading it.

6. **A Space whose folder is gone asks where it went** (ADR 0005,
   decision 6). The engine still lists it, `missing`, and opens none of
   its Threads. Its row says the folder is missing and offers "Locate
   folder", the same path field and picker; the folder found is written
   into `space.json`.

7. **"Git URL" clones** (_later_, as T3 Code's): a URL, then where to
   clone it, its folder's name filled in ("Clone", "Create & Clone");
   the Space is added at once and the clone runs in the engine, its
   progress in a notice ("Cloning {name}", "Cloned {name}", "Failed to
   clone {name}", with "Retry" and "Remove Space").

8. **Not now.** A Space's icon or favicon, its scripts, a Thread in its
   own git worktree, a Space on another machine (ADR 0005, decision 6),
   a provider's repositories as a source, an export that carries a
   Space's Threads with its folder.

**Consequences.**

- ADR 0001, decision 5, is changed as ADR 0005 said: copying the folder
  no longer moves the Threads.
- `GLOSSARY.md`: a Space is any folder; its data is in the engine's data,
  not in `.banda/`.
- `docs/architecture.md`: the places gain data.
- The order of work, each step its own PR:
  1. This ADR.
  2. The data out of the folder: the data place, `space.json` with the
     folder, the move of the existing Spaces, the kept files as an extra
     root.
  3. `spaces.add`, `spaces.browse`, `spaces.update`, `spaces.remove` and
     `banda space add`.
  4. "Add Space" in the Banda menu: "New Space" and "Local folder", and
     every way in.
  5. The system's folder picker.
  6. The Space row's menu and the settings' "Spaces" section.
  7. A missing folder and "Locate folder".
  8. "Git URL".
