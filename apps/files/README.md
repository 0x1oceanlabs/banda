# Files

The Files App: any folder as a Finder shows it, one file in a Pane, and
Quick Look. [The architecture](../../docs/architecture.md#files) is the
map this page is one part of. A change to this App changes this page in
the same PR.

## What it does

- **The engine reads the disk, and watches what is shown** (ADR 0073,
  decision 4): `files.list`, `files.stat`, `files.read` (text up to
  1 MiB, or that it is binary), `files.find` (fuzzy, gitignore-aware)
  and the stream `files.watch`, on the kernel's watch service. Each path
  goes through the kernel's path guard, `Reach`: a relative path starts
  at the Project's folder, the Person reaches any, an Agent only its
  Project's. It only reads; writing comes later.
- **It keeps what the Person opened**, in `files_recent` (path, last
  time, count): `files.file` says each file it shows with the command
  `files.opened`, `files.recent` lists them, and `files.find` raises them
  a little among matches of their kind. `files.places` answers home,
  Desktop and Downloads as the system names them (XDG's user dirs on
  Linux).
- **`files.find` answers every "which file"**: the composer's `@` and the
  Banda menu's Files, a source of the files module's own. The menu opens
  `name:42` at line 42; its Tab offers "Show in Files" too.
- **`files.tree`** is any folder as a Finder shows it, one Files Pane per
  Project that the menu's Files (`files.tree`, Alt+E), "Show in Files"
  and `banda files [path]` find again:
  - the places on its left (the Projects with their badges, Home,
    Desktop, Downloads, what `files.toml` pins, Recent), folded to icons
    on a narrow Pane;
  - its path as crumbs, a field on a click or Ctrl+L, Tab completing a
    folder from `files.list`;
  - the tree, `@pierre/trees` behind `@banda/ui`'s `FolderTree`: one
    folder listed as it opens, a folder of one folder as one row, what git
    ignores greyed, dotfiles on Ctrl+Shift+., git's marks from the git
    module's `git.watch` where the folder is in the Project, the open
    folders watched with `files.watch`;
  - typing filters it with `files.find`, the matches under their folders.

  Its keys are its own, with Ctrl (⌘), never the mod; each is also an
  unlisted action (`files.up`, `files.path`, `files.hidden`,
  `files.filter`) that `keys.toml` can bind, until ADR 0071's scopes.
- **`files.toml`** (ADR 0073, decision 13) holds the pinned places,
  whether hidden and ignored files show, and `[previewers]`, the
  previewer an extension shows in; a folder's menu pins it and "Open
  with…" picks one through the settings bridge.
- **Its Pane** (`apps/files/pane`), `files.file`, shows one file, one
  Pane per file. `files.stat` says what it is, and the previewer that
  claims it draws it (`previewers.ts`, each view in `views/`):
  - code and text: `files.read`, drawn by `@banda/ui`'s `CodeFile`, the
    Diff's `@pierre/diffs` view and colours with numbered lines, opened
    at a line centred and lit once; past 1 MiB or 20 000 lines, its start
    with a note. Lines picked in the gutter copy as `path:12-20`;
  - markdown: the Thread's Streamdown, its source a toggle away, its
    pictures through the file host from the file's folder;
  - an image: an `<img>` from the file host, an SVG too, to zoom and pan;
  - a PDF: PDF.js in a module worker, its bytes read from the file host
    in 64 KiB ranges as pages need them, the pages drawn only near the
    view with their text to pick, find on Ctrl+F (⌘F), the zoom, and the
    pages' pictures in a wide Pane;
  - video and sound: Chromium's players on the file host, which seek in
    ranges; one Chromium cannot play shows its facts and its app;
  - a page, HTML or an SVG document: a frame of the sandbox host,
    `app://preview`, its source a toggle away;
  - anything else, and what reads as binary: its facts.

  It follows `files.watch` on the file's folder, reads again as it
  changes, and keeps its scroll.
- **Quick Look** (ADR 0073, decision 7) is `files.file` over the desk:
  Space in the tree runs `files.peek`, which asks the window to show the
  Pane in its one floating tile (`WindowApi.peek`, `PaneProps.peek`);
  the tiling stays, the tree keeps the keys, and as the pick moves the
  tile is given the next file. Esc or Space closes it, ↵ opens the file
  as a Pane, and the Banda menu's key has it fill the desk. A reply's
  path menu and the Banda menu's Files show a file there too.
- **Every link to a file opens it there**: the window's `file.open` runs
  the files module's `files.open`, which opens the file beside the Pane
  it was opened from, or takes the Pane that shows it to the new line
  (`WindowApi.open` with `update`). A reply's paths and a terminal's
  carry their line.
