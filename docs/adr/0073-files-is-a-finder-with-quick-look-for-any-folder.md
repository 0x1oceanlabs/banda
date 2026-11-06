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

   *Amended 2026-11-06, with step F6:*
   - **The keys are a scope's.** A Files Pane's tile is the scope `files`
     (ADR 0071, decision 1): every key of F1d's and F5's, Quick Look's
     Space, and F6's are its actions, bound in `[binds.files]`, listed in
     the key sheet under Files, each with its key in force. The window
     matches them; the Pane takes one where its view has the focus, and
     only Ctrl+L and Ctrl+Shift+F in one of its fields, so a field keeps
     its own Space and Ctrl+Z. A key taken goes no further, so Pierre's
     tree never reads F2 or ↵ itself. `files.peek` still takes a file, as
     a reply's path menu asks.
   - **The views are Ctrl+1, 2 and 3** (⌘ on a Mac), not the mod: a scope
     narrower than the window never holds Banda's mod (ADR 0071, decision
     1), and Files' keys are Ctrl's, as F4's save is. The header has the
     same as a quiet switch of three icons. The view is the Pane's, in its
     args (`view`), as the info is (`info`).
   - **One pick, three views.** The pick, the menu, the drag, a drop on a
     folder, a rename in place, the operations, Quick Look, ↵ and the
     Agent's marks and pulse are the Pane's and the same in each; a view
     only draws the folder and moves the pick with its arrows. Each lists
     and watches the folders it shows: the tree its open ones, Columns
     those from the top to the pick, a Gallery the pick's folder. The
     filter's matches show as a tree in every view. The tree is drawn with
     the pick's folders open, as another view may have picked in a folder
     it folded.
   - **Columns** are Miller columns, as a Finder's: each folder from the
     Pane's to the pick a column, the folder open in the next lit in its
     own. ↑ ↓ move in a column, → goes into the folder picked, ← back to
     its folder. A file picked is drawn in a last column by its previewer
     in quick mode, with its info under it, or its info alone where no
     previewer draws it so. Columns show the info unless the Pane hid it.
   - **A Gallery** draws the pick big, as a column draws it, over a
     filmstrip of what its folder holds, each item with its small picture
     or its icon. ← → move along it, and it keeps the pick in its middle;
     only the items in view are drawn and pictured.
   - **The info** (Ctrl+I) is a quiet panel at the right of the tree or
     the Gallery, and a section under Columns' preview: the row's small
     picture or icon, its name, kind and size; then its type, its times
     (made, where the system keeps it; modified; opened), its permissions
     as `ls` writes them, its owner and group, where a link leads and
     whether it leads anywhere; a picture's size and what its camera
     wrote; and the last commit that changed it, its subject, author and
     when. A folder's size is counted only when asked, and stops with
     Stop or another pick. What was shown stays until the next row's
     comes.
   - **Small pictures in the tree** only when `files.toml` says
     `thumbnails = true`: off by default, so the tree stays quiet. The
     Gallery and the info show them always.

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
   | `files.trashed`; `files.delete`, `files.empty`, `files.cancel` | call; command | Read; Write | Decision 10, as amended |
   | `files.search { dir, query, regex, case, word, limit }` | stream | Read | Decision 11, as amended |
   | `files.thumb { path, size }`; `files.info { path }` | call | Read | A small picture, or none; what a path is at length (decision 5, as amended) |
   | `files.size { path }` | stream | Read | What a folder holds, counted as it goes; letting go stops it |

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

   *Amended 2026-11-06, with step F3a:*
   - **The page reads the byte host's ranges** with `fetch`, as a PDF is
     read: the `app` scheme allows CORS, and the page's `connect-src`
     names `app://files`. Its `frame-src` names `app://preview` beside
     the modules' hosts, never `app://files`.
   - **The sandbox host signs its own links**, by a secret of its own, and
     serves only HTML, XHTML and SVG. Its CSP is `default-src 'none';
     img-src app://files data:; style-src 'unsafe-inline'; script-src
     'unsafe-inline'; sandbox allow-scripts`, so a page is sandboxed with
     no origin of its own even outside a frame that says so.
   - **It answers a frame's navigation only.** Electron's protocol
     handler hears no `Sec-Fetch-*`; a navigation there is what asks to be
     upgraded (`Upgrade-Insecure-Requests`) and names no `Origin`, which a
     page's `fetch` cannot ask without a preflight the host refuses. Where
     `Sec-Fetch-Dest` comes, it must say a frame.
   - A page's pictures by relative paths do not show yet.

   *Amended 2026-11-06, with step F6:*
   - **Small pictures ride the RPC.** `files.thumb { path, size }` answers
     a PNG, in base64 with its size, or none, and the window draws the
     file's icon. A size asked is made at the next of 64, 128, 256 and
     512 px, its longest side. A picture comes from, in order:
     1. **Banda's cache**, `~/.cache/banda/thumbnails` (`BANDA_CACHE`
        moves the cache folder), one file per path, time in ns, size in
        bytes and size made, hashed. It keeps the latest used 128 MB; a
        file's time says when it was used, and past the cap the oldest go
        until a quarter is free.
     2. **freedesktop's**, `$XDG_CACHE_HOME/thumbnails` on Linux, named by
        the MD5 of the file's URI as GLib escapes it, and taken only while
        its `Thumb::URI` names the file, its `Thumb::MTime` is the file's
        time in seconds, and its `Thumb::Size`, where it says one, the
        file's size. A bigger one is scaled down and kept; a smaller one
        serves when no bigger is there. So a video or a PDF the desktop
        pictured shows its own. `BANDA_THUMBNAILS` moves it, and empty
        leaves it alone, as a test and a trial's window do.
     3. **The file**, when its name says a picture `image` reads in Rust
        (PNG, JPEG, GIF, WebP, BMP, TIFF): never one past 64 MiB, nor one
        that needs more than 256 MiB to hold; two at a time, off the
        engine's threads; turned as its EXIF says, and scaled with
        `fast_image_resize` (Lanczos3). AVIF is not read: its decoder is
        C (dav1d).
   - **What is made is kept twice:** in Banda's cache, and in
     freedesktop's at its sizes (128, 256, 512), as a good neighbour does,
     with `Thumb::URI`, `Thumb::MTime` and `Thumb::Size`, written whole
     and this user's only. So a picture is a PNG, not a WebP: freedesktop
     keeps PNGs, and one encoding serves both.
   - **Later:** macOS's QuickLook (`QLThumbnailGenerator`) and Windows'
     shell first, before decoding; a PDF's first page (`pdfium-render`);
     a video's frame (an LGPL `ffmpeg` beside Banda).
   - **The window** asks four at a time, keeps the last 400 by path, time,
     size and size asked, and lets go of an ask whose item left the view
     before its turn came.
   - **`files.info { path }`** says the path itself (a link is a link)
     and, where it leads, its MIME type, size, a folder's count of names,
     its times, its permission bits and owner and group by name (`nix`),
     a picture's size from its header and its EXIF (`kamadak-exif`):
     camera, lens, when taken, exposure, and the place as text, never a
     map. The last commit is `git log -1` for the path, run as F1's
     `check-ignore` is: no locks taken, no prompts, nothing it inherits
     naming another repository, and at most 5 s. Modules do not import
     one another, so Files runs git itself.
   - **`files.size { path }`** walks the folder, a link not followed, and
     says the bytes and files counted every 100 ms, then that it is done.

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

   *Amended 2026-11-06, with step F3a:*
   - `definePreviewer` takes a `title` too, which "Open with…" shows.
     `match.magic` is bytes a file starts with, maybe after an offset.
     Among the matches, an extension is closest, then a MIME type, then a
     family of them (`video/*`), then the bytes; the higher priority wins
     among equals. The bytes are read only when nothing else matches.
   - The view's file carries `url`, the byte host's, which answers ranges
     itself (a player seeks in it); `read(range)` asks it for bytes. It
     carries the path as the Person reads it too, and the view gets the
     engine, the Project and `run`, for what rides the API, as text.
     What a view keeps with its Pane, as markdown's Source, it keeps with
     `kept` and `keep`.
   - The window builds the previewers from the modules and gives them to
     every Pane in a React context, `@banda/ui`'s `Previewers`; a view is
     keyed by its previewer, which is how it updates rather than remounts.
   - "Open with…" is a button in `files.file`'s header; the pick is
     `files.toml`'s `[previewers]`, written through `files.previewer`.
   - PDF.js draws with its own canvas and text layer, not its viewer's
     component: the pages are placed at once and drawn only near the view.

   *Amended 2026-11-06, with step F3b:*
   - **A previewer may draw any file** (`match.any`), after every other
     match. Hex is Files' for a file nothing else claims, and "Open
     with…" offers it for every file. The bytes a file starts with are
     still read when only such a previewer matches.
   - **Tables.** A CSV's rows are found in one pass over the byte host's
     ranges, then only the rows in view are read again and parsed; the
     first rows and the last size the columns. Past 2 000 000 rows the
     rest is not shown. `@banda/ui`'s `VirtualList` draws them: our own,
     not TanStack's, as its rows are of one height and the hex grid needs
     more rows than a page may be tall.
   - **JSON** past 5 MB, or that does not parse, shows as code. A `.json`
     with comments parses as JSONC.
   - **A notebook's HTML outputs** are drawn as a reply's HTML is:
     sanitized, with no scripts and no styles. The sandbox host serves a
     file by its link and takes no HTML that is not one; an output that
     needs its scripts shows its text. The host may take them later, as a
     part of the notebook's file.
   - **Fonts** load through `FontFace` from their bytes, and Files reads
     their names and characters itself. A WOFF2 packs them with Brotli,
     which Chromium's `DecompressionStream` does not unpack yet: it shows
     with its file's name.
   - **Archives** are listed by the engine, `files.archive` (Read): zip,
     tar, a gzipped tar and 7z, at most 10 000 names, on `zip`, `tar` with
     `flate2`, and `sevenz-rust2`, none with codecs of their own. A name
     is only text: `../x` is shown, never resolved. Taking files out comes
     later.
   - **Workbooks** (xlsx, xls, ods) are read by the engine, `files.sheet`
     (Read), on `calamine`: the first 10 000 rows of a sheet, as the
     workbook kept their values.
   - **Hex** reads the byte host's ranges as its rows come into view, not
     the RPC: the host answers ranges already, and bytes need no base64.
     Ctrl+G (⌘G) goes to an offset, as Files' keys are Ctrl's, not the
     mod's.


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

   *Amended 2026-11-06, with step F3a:*
   - **The window draws the tile; a module asks for it.**
     `WindowApi.peek(pane, project)` shows a Pane in the one floating tile
     over the workspaces, and `null` closes it; the Pane is told it peeks
     (`PaneProps.peek`). A Pane of the same kind there takes the new args,
     so its view updates. A Pane opened in a workspace that the tile
     shows closes it, as ↵ does. The window knows no module: Quick Look is
     the files module's `files.peek` asking for `files.file`.
   - **⌥Space is the Banda menu's key** (ADR 0068's mod with Space).
     While Quick Look shows, that key has the tile fill the desk, or float
     again, as ⌥Space does in a Finder; the menu opens once it is closed.
     The tile's header has the same as a button.
   - Esc closes the tile wherever the focus is, unless a menu, a dialog or
     a list of suggestions takes it first. Space closes it from the tree.
   - Space is the tree's key, and `files.peek` its action for
     `keys.toml`, until ADR 0071's scopes, as F1d's keys are.
   - A row's menu, a reply's path menu (ADR 0063) and the Banda menu's
     Files have "Quick Look" too.

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

   *Amended 2026-11-06, with step F4:*
   - **The write.** `files.write { path, text, base }` writes only while
     the file's SHA-256 is `base`; `base: null` asks that no file be
     there. A file that holds the text already answers its hash, so a
     command sent again is no conflict. Else it answers `moved`: the hash
     now, and who wrote it, when that write came through Files. The text
     goes to a new file beside, with the file's permissions, which is
     renamed over it.
   - **Links.** The guard follows them, and holds an Agent in its
     Project: the target is written, and the link stays a link. A link
     still there at the end leads nowhere, and is refused.
   - **Banda's settings** are its config folder (`~/.config/banda`, or
     `BANDA_CONFIG`), which the engine gives the module, as it gives the
     agents module: nothing in it is written. `files.read` says why a
     file will not be (`locked`: `.git`, the settings, or a file this user
     may not write), so the pencil says so before a write is tried.
   - **Who.** "The Agent", with its Thread's name, when `agents.touching`
     showed a turn writing the file then or up to 5 s before; else whom
     the engine names; else "another app".
   - **The keys.** E edits and Esc is done, where nothing else takes
     them. The save is Ctrl+S (⌘S): the Pane's keys are Ctrl's, and Alt+S
     is Banda's.
   - **The draft is the module's**, one for each file in the window, held
     by its Panes; the view gets no `dirty` nor `save`, as only Files'
     views edit yet. One the disk moved under stays while the window
     runs, so its file opened again has it. A Pane's label says what is
     not saved, a dot, or saved a moment ago (`Label.edits`).
   - **A task's box** is counted in the order the boxes show, and writes
     only while they are the tasks its text has.

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

    *Amended 2026-11-06, with step F5:*
    - **The operations.** `files.make { dir, name, kind }`, `files.rename
      { path, name }` and `files.trash { paths }` are commands;
      `files.move` and `files.copy { paths, dir, clash, answers, job }` are
      streams with the Write right, heard once, as `git.act` is. Each acts
      on what is at a path, a link as a link, never through it; each path
      goes through the guard, and none is in `.git` or Banda's settings,
      nor holds the settings when it would go.
    - **A job.** A move within a disk is a rename; across disks it is a
      copy, then the first is removed. A copy goes a piece at a time and
      says how far its bytes are, at most ten times a second.
      `files.cancel { job }` stops it, as letting go of the stream does:
      what it left half done is removed, and its end says what it did. The
      window shows a job's progress in its toast once it has run 400 ms,
      with Stop.
    - **A clash.** Asked (`clash: ask`), a job does nothing and answers the
      names taken; the window asks Replace, Keep both or Skip, one after
      another or "for all", and sends the answers by path. Replace sends
      what is there to the Trash first. Keep both takes `name 2.ext`, then
      3, the extension kept (`.tar.gz` whole), a folder's whole name
      counted. A copy into its own folder is a duplicate and asks nothing;
      a move there stays.
    - **Undo.** Each answers the steps that undo it, Files' commands again:
      rename back, move back (asking, so nothing is written over), the
      Trash for what was made or copied (as a Finder undoes a duplicate),
      and putting back from the Trash. The window keeps the last 20, its
      own; Ctrl+Z (⌘Z) in the tree takes the latest of its Project, and a
      toast's Undo its own.
    - **The Trash.** `files.trash` uses the `trash` crate. The system says
      no id as it trashes, so Files finds each again by where it came from
      and when, and answers those ids. `files.trashed` lists the Trash,
      `files.restore { items }` puts back, `files.delete { items }` deletes
      items of the Trash for good and `files.empty` all of it; an Agent's
      call sees and acts only on what came from its Project. macOS lets no
      app list its Trash nor put back (`~/.Trash` needs Full Disk Access,
      and Finder renames what it holds): there a Trash has no Undo, its
      toast says Finder puts it back, and the Trash place says Finder keeps
      it and opens it there.
    - **The window's clipboard.** Ctrl+C and Ctrl+X keep the rows' whole
      paths in the window, and put them on the system's clipboard as text,
      a line each; Ctrl+V copies or moves them into the folder picked, or
      the picked file's.
    - **A drag** of rows onto a folder of the tree moves them, as main's
      drag brings them back or the page's carries them; Alt (⌥) or Ctrl
      held as they drop copies. Alt is Banda's mod as a drag starts, so it
      is pressed on the way.
    - **New file and New folder** make `untitled` and `untitled folder`
      (then 2, 3) at once, as a Finder does, and the row is named in place;
      Escape keeps the name. F2 renames in place with the name before its
      extension picked.
    - **Bulk rename.** Several rows picked, Rename opens their names, one a
      line, in Banda's editor in a dialog; Review changes shows old against
      new in the shared diff view. A name empty, holding a `/`, given twice
      in a folder or taken there is refused; the renames go where each
      name is free, a ring through a name aside, what a folder holds before
      the folder, and they undo as one.
    - **The keys** are the tree's own, as F1d's are, each with an action
      by id for `keys.toml`: F2, Ctrl+⌫ (⌘⌫) or Delete, Ctrl+Z, Ctrl+C, X
      and V, Ctrl+D, Ctrl+N, Ctrl+Shift+N and Ctrl+Shift+F. The key sheet
      lists them once the tree is a scope (ADR 0071).
    - **`move` is a keyword** in Rust: the kernel's `methods!` takes a
      method's name as a raw identifier (`r#move`), and the window calls it
      `move`.

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

    *Amended 2026-11-06, with step F5:*
    - **`files.search { dir, query, regex, case, word, limit }`** is a
      stream (Read). It walks with `ignore`, leaving out what `.gitignore`
      does and `.git`, and reads each file with `grep-searcher` and
      `grep-regex`'s matcher, a binary file skipped. Each file's lines come
      as they are found, at most 100 a file, until the most asked (2 000
      unless said, 10 000 at most); then the files and lines, and whether
      it stopped there. A line says its matches as JavaScript counts a
      string; a long one is cut to about 300 characters around its first
      match. Letting go of the stream stops it.
    - **In `files.tree`**, Ctrl+Shift+F turns the tree into the lines
      found, grouped by file, searched again 150 ms after typing stops,
      with Match case, Whole words and a regular expression as toggles. ↵
      or a double click opens `files.file` at the line, lit; Esc gives the
      tree back.
    - **Quick open** is Alt+P (the mod with P, which nothing held): the
      Banda menu with the Project's files alone, what was opened lately
      first before a word is typed. The menu's `menu.open` takes a
      `source`, and `banda menu find.<source>` opens it so, with no module
      named in the window.

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

      *Amended 2026-11-06, with step F6:* the views, the small pictures
      and the info came (decisions 3 and 5, as amended). A line's blame
      and tags wait, and the Grid view the research names.
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
