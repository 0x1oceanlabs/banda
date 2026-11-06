---
status: accepted
date: 2026-11-06
---

# Files is a Finder with Quick Look, for any folder

ADR 0034 gave Files a single step (step 5). That step had two Panes and was
read-only:

- `files.tree` with search and "Copy path" and "Add to chat";
- `files.file` with numbered lines, Shiki colours, markdown and images.

It moved `agents.files` into the module and left editing for later
(decision 11). ADR 0063 then made a path in a reply a link that opens "in
Banda". Until `files.file` exists, that means the browser's tab.

On 2026-11-04 Roma asked for more than a step: "a finder and previews of
files, and some basic work with them". He wanted something elegant and
functional that can grow in depth, with previews of media, PDF and code
and maybe light editing, and he wants it to be "our start on the Banda
App SDK". The research is `docs/research/2026-11-04-files.md`. It found
four things:

- **T3 Code's Files is wide.** It has a lazy tree, a viewer, an editor that
  saves as one types, and previews of a dozen formats. But it watches no
  file, checks no conflict, and has no file operations.
- **The other agent apps centre on the diff.** What they all do well is
  make a path actionable.
- **Banda already has most of the parts.** `@pierre/trees`, `@pierre/diffs`
  and its editor are installed, and `app://files` already serves media with
  signed tokens and ranges.
- **What is missing is mostly SDK.** There is no byte channel, no typed
  desktop bridge, no watching, no path guard, no previewers, and no
  composer attach.

The research also measured the two candidate editors (§4).
`@pierre/diffs/edit` was two to three times faster than CodeMirror 6 on
files up to 20 000 lines. It adds 169 KB to what Banda ships, against
about 600 KB for CodeMirror. It is heavy at 100 000 lines.

The mock is `artifacts/files/files-v1.html` in the brand workspace. It
sets today (no tree; a file opens as a `file://` page) beside a Files Pane
with:

- places on the left and a path that can be typed;
- tree, columns and gallery views, with git and turn marks;
- the Agent's file pulsing, and Follow;
- previews, Edit, and the conflict bar;
- a row's menu, and a path chip in a reply;
- Quick Look three ways: A a floating tile, B a column, C a preview Pane.

Roma's answers:

- On 2026-11-05: "любая папка как настоящий файндер" (any folder, as a
  real Finder), editing yes, and "let's compare" the editors.
- On 2026-11-06: "1 A, 2 дерево, 3 давай pierre". That is Quick Look A,
  the tree as the default view, and Pierre.

## Decision

Roma decided the points marked _decided_. The rest are our defaults and
stay his to change.

1. **Files is an App for any folder** (_decided_: "as a real Finder").
   - The `files` module has its own engine part and Pane part, the first
     App built on the App SDK's pieces (ADR 0062, a draft; decision 14).
   - **It opens on the focused Project's folder.** Any other folder can be
     opened from its places, its path, the Banda menu or `banda files
     <path>`.
   - **The places are a rail on the left.** In order: the Projects, with
     their signs (ADR 0070); Home; Desktop; Downloads; what the Person
     pinned; Recent; the Trash.
     - The rail folds to icons, and it is folded at first in a narrow
       window.
     - Pinned places are kept in `files.toml`.
   - **A Pane remembers its folder** (`args.dir`), so a workspace brings
     it back.

2. **The Panes.**

   | Kind | What |
   |---|---|
   | `files.tree` | The browser: the places, the path, the view, the marks |
   | `files.file` | One file, drawn by the previewer that claims it, opened at a line |

   - Quick Look is `files.file` in its quick mode (decision 7), not a
     third Pane.
   - Both kinds start with `files.`, as ADR 0022 asks.

3. **The tree is the default view** (_decided_). Columns and Gallery
   come later (step F6), over the same selection, on Mod+1…3.
   - **The tree is `@pierre/trees`, as the Diff's is, behind our own
     component.**
     - It lists one folder at a time and loads a folder as it opens.
     - A folder of one child shows as one row (`a/b/c`).
     - "Expand all" passes over ignored folders.
   - **Ignored files are shown, greyed, not hidden**, by `git check-ignore`
     as T3 Code does. "Hidden files" (Mod+Shift+.) shows dotfiles. Both
     choices are kept per Pane.
   - **The marks.**
     - git's status: M, A, and a dot on a folder that holds changes, from
       `git.watch`.
     - A quiet dot on what the running or last turn changed, from the
       checkpoints (ADR 0034, step 2).
   - **The filter.** Typing, or `/`, filters the tree as one types,
     keeping the folders of what matches, as broot does.
   - **The path** is breadcrumbs. A click or Mod+L turns them into a
     field, and Tab completes in it.
   - **The keys.**
     - ↑↓ move, ← and → fold and open.
     - Space is Quick Look; ↵ opens.
     - F2 renames.
     - Mod+⌫ moves to the Trash, and Mod+Z undoes it.
     - Every key is an action (ADR 0071, a draft), so `keys.toml` can
       move it.

4. **The engine reads the disk, and watches what is shown.**

   | Method | Kind | Right | What |
   |---|---|---|---|
   | `files.list { dir }` | call | Read | One folder: name, kind, size, time, ignored, link |
   | `files.stat { paths }` | call | Read | What each path is, or that it is gone |
   | `files.read { path, upto? }` | call | Read | Text up to 1 MiB, or that it is binary or larger |
   | `files.find { dir, query, limit }` | call | Read | Fuzzy paths (decision 11) |
   | `files.watch { dirs }` | stream | Read | What changed in the folders shown |
   | `files.write { path, text, base }` | command | Write | Saves when the file is still at `base` (decision 8) |
   | `files.make`, `files.rename`, `files.move`, `files.copy`, `files.trash`, `files.restore` | command | Write | Decision 10 |

   - **Watching** uses `notify` with its debouncer:
     - one watch per folder shown (FSEvents on macOS is recursive and
       cheap; inotify on Linux has a limit);
     - changes 120 ms apart come as one;
     - on overflow the folders are read again.
   - When the limit is reached, Files says so once, with how to raise
     `max_user_watches`.
   - **Paths are checked** by the kernel's path guard (decision 14). The
     Person may reach any folder. An Agent's call reaches only its
     Project's folder, as its tools do.

5. **Bytes come through a host, not the RPC.**
   - `app://files` (ADR 0037, decision 8) moves from the agents module
     into `desktop-kit`, as a host any module may use.
   - It keeps its HMAC tokens bound to the path, device and inode, its
     `O_NOFOLLOW`, its ranges, its `sandbox` CSP and its `nosniff`.
   - It now serves every type, and it checks the path with the guard.
   - A Pane asks for a URL with `useFileUrl(project, path)`, typed, and
     stops casting `window.banda`.
   - **Untrusted pages go to a second host**, `app://preview`: HTML, SVG
     documents, and a notebook's outputs. Its frames get
     `sandbox="allow-scripts"` without `allow-same-origin`, and a strict
     CSP. The page's `frame-src` allows the two hosts.
   - Text up to 1 MiB and small thumbnails stay on the RPC.

6. **A file is drawn by a previewer.**
   - A module declares a previewer in `defineModule({ previewers })` with
     `definePreviewer({ id, match, priority, can, load })`.
     - `match` takes extensions, MIME types and magic bytes. `can` says
       quick, edit and find.
     - `load` is a lazy import, so a format costs nothing until it is
       opened.
   - **The order a previewer is picked in:** extension, then MIME, then
     magic bytes, then priority. "Open with…" lets the Person pick
     another, and the pick is kept per extension.
   - **The view gets** the file (path, name, MIME, size, time, `url(range)`),
     `read(range)`, the mode (quick or pane), the line, the theme, an
     abort signal, and, when it edits, `dirty` and `save`.
   - **As the selection moves within one kind, the view updates and is not
     remounted.** That keeps Quick Look instant.
   - **Files' own previewers.**
     - **First (step F1):**
       - Code and text, on `@pierre/diffs`' `File`, coloured as the Diff
         is, numbered, opened at a line that is centred and lit.
       - Markdown, rendered by `@banda/ui`'s Streamdown, with a Source
         toggle.
       - Images, with zoom and pan. An SVG is drawn only as `<img>`.
     - **Then (step F3):**
       - PDF (`pdfjs-dist`).
       - Video and audio, natively.
       - CSV and TSV as a virtual table.
       - JSON.
       - A notebook's saved outputs, never run.
       - Fonts.
       - Archives as folders.
       - Hex for what nothing else claims.
   - **A file Chromium cannot play or draw** (HEVC without hardware, AVI,
     HEIC on Linux) shows its facts and "Open in ‹app›".
   - **Lines.** Picking lines in `files.file` offers "Add a comment…", which
     ADR 0034 decision 9 sends to the Agent.

     *Amended 2026-11-06, with step F2b:* the comment is written under
     the lines, and goes into the Thread's message as a chip with the
     path, the lines, the words and the lines as they read. The chip
     waits in the draft, can be taken out, and is sent after the text as
     `Comment on src/a.ts:12-14:`, the lines fenced, then the words, as T3
     Code frames a file comment. The Diff's comments wait: a comment
     there names lines of two sides, as a patch, which a chip does not
     carry yet.

7. **Quick Look is a floating tile over the desk** (_decided_: A).
   - Space on a row shows the file in a glass tile over the desk (ADR 0023)
     and leaves the tiling as it is.
   - ↑↓ keep moving in the tree under it, and the tile follows.
   - Space or Escape closes it. ↵ opens the file as its own `files.file`
     beside, and ⌥Space makes the tile fill the desk.
   - The tile takes no focus from the tree. Every previewer that `can`
     quick draws in it.

8. **Light editing, in Pierre's editor** (_decided_: editing comes;
   _decided_: Pierre). This replaces "Editing files" in ADR 0034
   decision 11.
   - `files.file` edits with `@pierre/diffs/edit`, so a file, its diff and
     its edit look and behave as one.
   - It sits behind Banda's own `Editor` interface in `@banda/ui`, so
     CodeMirror can later take a mode or a kind (vim, LSP) without a Pane
     knowing.
   - **Edit is chosen** (E, or the header's pencil). A dot marks unsaved
     work.
   - **Saving.** It saves 500 ms after typing stops and as the Pane
     closes. Mod+S saves at once.
   - **Every write carries the hash the text was read at** (`base`).
     - When the disk has moved, nothing is written and a bar says "Changed
       on disk by ‹the Agent | another app›", offering **Compare**, **Take
       theirs** and **Keep mine**.
     - Compare opens the two in the shared diff view.
   - Nothing is lost silently. This is where Banda differs from T3 Code,
     whose last writer wins.
   - **Past 1 MiB or 20 000 lines a file is read-only**, in a view that
     reads it in ranges. The measured cost of Pierre's editor there is
     hundreds of MB.
   - **These are read-only:** what is inside `.git`; a file the Pane
     cannot write; Banda's own settings files, which the settings window
     edits (ADR 0016).
   - **In markdown's rendered view, a task's box can be ticked**, which
     writes the line.

9. **The Agent's work shows on the tree.**
   - The row of the file the running turn reads or writes pulses quietly,
     in the Harness's colour, from the turn's tool calls.
   - **Follow** (the header's target) moves the selection, and the open
     `files.file`, to that file. While the Person edits, Follow waits.
   - Follow is off by default (_decided_), and kept per Pane.

   *Amended 2026-11-06, with step F2b:*
   - **Where the file comes from.** The engine kept a tool call's title
     and diffs, not the files ACP names (its locations). The agents
     module now keeps, in memory only, the file each running turn works
     on, by its tool calls as they start, and says it in a stream,
     `agents.touching`: a Thread, the file, the line, read or write, and
     when. Edit, delete, move and a diff write; read reads; a search, a
     command or a fetch touches no file. A turn's file goes as it ends.
   - **The colour** is the Thread's Harness entry's account colour (ADR
     0078, decision 10).
   - **Which Thread.** A Files Pane is with the Thread it was opened from
     (the focused Pane's, kept in its args), else the Thread at work that
     began last, else the one whose turn began last. Its turn's marks and
     Follow are that Thread's; every Thread's file pulses.
   - **Follow's rule.** It goes to each file written, and to a file read
     unless a write came less than 4 s before. It moves the pick and the
     `files.file` the tree opened, else the one shown last in the Project,
     at the line named. It waits 5 s after a key or a click in a Files
     Pane, and while text or lines are picked or a comment is written
     there. It moves only while the turn runs.
   - **The turn's marks** are `git.diff`'s Turn, with what its tool calls
     changed outside the folder, or `agents.changes` where git kept no
     checkpoint, read as the turn starts and again as it ends. While it
     runs, each file it writes is marked as the write starts.

10. **Files does what a Finder does with files.**
    - New file and New folder, Rename (F2, in place), Duplicate, Move (drag
      within the tree, or cut and paste), Copy.
    - Move to Trash, which uses the system's Trash (`trash`). Each
      operation is undone by Mod+Z or by the toast's Undo, and the Trash
      restores.
    - Long copies and moves run as jobs with progress. A clash asks:
      Replace, Keep both, or Skip.
    - Deleting for good happens only in the Trash, and asks first.
    - **A row's menu:**
      - Open
      - Quick Look
      - Open in ‹editor› (the editors found on the machine, as T3 Code
        lists them)
      - Open with the system
      - Reveal in the system's file manager
      - Add to chat
      - Copy path ▸ (full, relative, name)
      - Rename, Duplicate
      - Move to Trash
    - Rows drag into the composer as `@` chips, and out to other apps as
      files.
    - Bulk rename, as text with a diff before it applies, comes later (step
      F5).

11. **Finding a file is one engine call.**
    - `files.find` walks with `ignore` (gitignore-aware) and matches with
      `nucleo`, fuzzy, with a file's name above its folder and what the
      Person opened lately raised.
    - It replaces `agents.files` (ADR 0034, decision 5). The composer's `@`
      and the Banda menu's Files source ask it, and the source moves to
      the files module.
    - The menu's Enter opens `files.file`, not a `file://` page in the
      browser.
    - Searching inside files (`files.search`, ripgrep's `grep` crates,
      streamed) comes later (step F5).

12. **Links in replies open `files.file`.**
    - ADR 0063 decision 2 already finds paths, checks that the files exist,
      and draws the chips. Its "in Banda" now means `files.file` at the
      line, beside the Thread.
    - Ctrl or ⌘ with a click stays "in its app". The path's menu gains
      Quick Look.
    - Files takes ADR 0063's code over as its link claim (decision 14).
    - `files.file` joins the Panes an Agent may open (ADR 0034,
      decision 8). It shows and runs nothing.

    *Amended 2026-11-06, with step F2a, as the mock and T3 Code have it:*
    Ctrl or ⌘ with a click opens the file at its line in the editor
    `files.toml` names, or the first found; in its app only when no editor
    is found. The path's menu keeps "Open in its app" and gains "Open in
    ‹editor›". A terminal's path still opens in its app.

13. **`files.toml`** holds the pinned places and whether ignored and
    hidden files show by default. It also holds the editor to open in, the
    size past which a file is read-only, and the extensions mapped to a
    previewer. It follows the browser's settings pattern (ADR 0016).

14. **What Files needs from the App SDK** (ADR 0062). Each piece is built
    for Files and then serves every App:
    - **The byte host** and the sandbox host (decision 5), with
      `useFileUrl`.
    - **A typed desktop bridge for Panes**: reveal, open in an editor at a
      line (with the editors found), open with the system, save as, and
      drag out.
    - **A watch service** in the kernel, `ModuleSpace::watch(dirs)`:
      debounced, rescanned on overflow. git's `git.watch` moves onto it
      and stops polling every 3 s.
    - **The path guard**: one resolved path type that refuses `..` and
      escaping links, and holds an Agent to its Project's folder.
      `agents.media` takes it too.
    - **Previewers** (decision 6).
    - **Link claims**: a module claims a kind of link in replies (paths for
      Files, PR URLs for `pulls`).
    - **A Pane an Agent may open, said on the Pane** (`agent: true`), in
      place of `workspaces`' `AGENT_KINDS` list.
    - **Composer attach**: `WindowApi.attach(chip)` puts a path, lines or a
      comment into the focused Thread's composer.
      - From a Pane with no composer, as Files, it goes to the Thread that
        had the focus last in the same Project, and that Thread gets the
        focus. With none, a toast says so.
      - A Pane says it has a composer as it says its label
        (`PaneProps.composer`), so the window knows no module.
    - **The UI blocks** in `@banda/ui`: `CodeFile`, `Editor`, `FileIcon`
      (Pierre's icons), and a virtual list.

15. **Not now.**
    - Columns and Gallery views, thumbnails, the Info pane (EXIF, size, a
      line's blame), and tags. These are step F6.
    - Remote folders (SFTP, S3) and archives that can be written.
    - Previewers from modules not Banda's own, in a sandboxed frame. They
      come with ADR 0062's tiers.
    - An LSP, vim keys, folding and completion in the editor.
    - Office documents beyond a plain preview.

## Steps

Each step is one PR or two, tried in the window, with `/simplify` before
it:

1. **F1, a tree and a file.**
   - The `files` engine: `list`, `stat`, `read`, `find` (replacing
     `agents.files`), `watch` on the kernel's watch service, and the path
     guard.
   - `files.tree` with the places, the path, the tree and its marks.
   - `files.file` for code, markdown and images.
   - The byte host moved into `desktop-kit`.
   - The menu's Files opens `files.file`.
   - Paths in replies open `files.file`.
2. **F2, files reach the Thread.**
   - Composer attach, Add to chat, and dragging rows.
   - Open in ‹editor›, Reveal, Copy path.
   - The Agent's file on the tree, and Follow.
   - `files.file` an Agent may open.
   - Comments on lines.
3. **F3, the previewers.** `definePreviewer`, Quick Look's tile, then PDF,
   media, CSV, JSON, notebooks, fonts, archives and hex, with the sandbox
   host.
4. **F4, light editing.** The `Editor` interface on Pierre, the save with
   its base, Compare / Take theirs / Keep mine, the size cap, and the task
   boxes.
5. **F5, operations and search.**
   - New, rename, move, copy, duplicate, and the Trash with undo, with the
     jobs.
   - Bulk rename.
   - `files.search`.
6. **F6, depth.** Columns and Gallery, thumbnails, the Info pane.

ADR 0034's step 5 is this ADR's F1 and F2.
