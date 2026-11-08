# Documents and screenplays: an editor as in Notion, on plain files

How Banda could write documents as Notion does, with markdown as the main
format and Fountain for screenplays, and how such an App would work with
Files and Git by UNIX's rules: plain text between them, each one thing,
none importing another. It is read before an ADR (Roma, 2026-11-08: "I'll
make a document editor like Notion … markdown as the main format … and a
format for screenplays"; "tie it to Files and Git so they work together
the UNIX way").

- **Sources:**
  - Fountain's syntax, fountain.io/syntax (version 1.1).
  - CommonMark 0.31, on a fenced block's info string.
  - Banda's own: ADR 0015 (the prompt editor on tiptap), ADR 0020 (main in
    Effect), ADR 0037 (Visuals), ADR 0062 and ADR 0082 (Apps, intents,
    events), ADR 0073 (Files, its previewers and `files.write`), the Git
    App (`apps/git`, its diff and checkpoints).
  - The new architecture: `docs/architecture.md`, ADR 0082 (four kinds of
    message), ADR 0086 (the engine outlives the window), ADR 0089 (one
    client core), `2026-11-06-architecture-vision.md` §4 (borders,
    Unix-style).
  - Electron's `webContents.printToPDF`; Typst, `krilla` and `printpdf`
    for PDF on the host; afterwriting (an open Fountain renderer) as the
    model of a paginator.
- **Limits:** a conversation, not measurements. No editor or codec was
  built or timed here; libraries are named as candidates, to be checked in
  the ADR's research (`@tiptap/markdown` and `prosemirror-markdown` above
  all). The App's name is open (§8).

## 1. The idea

- **A file is the truth.** A document is a text file in the Project's
  folder, `.md` or `.fountain`, not blocks in a database as in Notion.
  - An Agent edits it as it edits code: it writes text.
  - Git's diff of it reads as text.
  - Banda keeps nothing of its own in the folder (GLOSSARY, Project).
- **The editor is a view over a string**, as the composer is (ADR 0015).
  It holds a ProseMirror document on tiptap, already in `@banda/ui`.
- **A codec stands at the edge.** `parse(string) → doc` and
  `serialize(doc) → string`. Markdown and Fountain are two codecs over one
  engine.

```
file ──parse──▶ ProseMirror doc ──▶ tiptap view (blocks, / menu, drag)
  ▲                                         │
  └──────────serialize◀──── edits ◀─────────┘
```

## 2. Two kinds of file, and a fenced block later

- **Decided in the conversation: two kinds of file**, `.md` and
  `.fountain`. It is simpler.
- **Markdown can carry a screenplay anyway.** A fenced block's info string
  is free in CommonMark:

  ````markdown
  ```fountain
  INT. KITCHEN — NIGHT

  ANNA
  (whispers)
  He is here.
  ```
  ````

  - Any other viewer (GitHub, Obsidian) shows it as code, so nothing
    breaks.
  - The editor sees the tag and draws a screenplay with the same codec.
  - So embedding comes later as one extension, with no change to either
    format. Mermaid and D2 come the same way (§6).

## 3. The Fountain codec

- **Our own parser.** The grammar is by lines and small. Parsers such as
  `fountain-js` give HTML but no way back to text, which is what we need.
- **The nodes:**

  | Node | In the text |
  | --- | --- |
  | `title_page` | `Title: …`, `Author: …` (as markdown's frontmatter) |
  | `scene_heading` | `INT. KITCHEN — NIGHT`, or forced: `.CELLAR` |
  | `action` | a plain paragraph; `!` to force it |
  | `character` | `JOHN`, `@McCLANE`, `JOHN ^` (dual dialogue) |
  | `parenthetical` | `(whispers)` |
  | `dialogue` | the lines under a character |
  | `transition` | `CUT TO:`, `> FADE OUT.` |
  | `section`, `synopsis`, `note` | `#`, `=`, `[[…]]` |
  | `centered`, `page_break`, `lyric` | `>text<`, `===`, `~` |
  | boneyard | `/* … */` |

- **Fountain depends on context.** `JOHN` is a character only after a
  blank line and before a line of dialogue. In the editor a block's kind
  is explicit, so the serializer must add the forcing mark (`@`, `!`, `.`,
  `>`) wherever the plain form would read as another kind.
- **The round trip is the safety rope.** Tests hold that
  `serialize(parse(s)) == s` on a corpus (fountain.io's samples and our
  edge cases), and that `parse(serialize(doc))` is the same doc. If it
  loses a character, the Person and the Agents spoil each other's files.
- **Open:** byte for byte, every space and spelling kept, or may the editor
  normalise the text on its first save? Byte for byte costs more in both
  codecs.

## 4. Writing a screenplay

What makes the tab worth it, as Final Draft and Highland do:

- **Enter** goes to the natural next block: dialogue after a character,
  action after dialogue.
- **Tab and Shift+Tab** change the block's kind: action, character,
  transition.
- **`(`** in dialogue starts a parenthetical.
- A scene heading and a character's name become capitals as typed. They
  are kept in capitals, not shown so by CSS.
- Character names and places are suggested from what is already written.
- The page looks like a screenplay's: Courier and the dialogue's margins.

## 5. Export to PDF and HTML

Both are wanted (Roma, 2026-11-08).

```
.fountain ─parse─▶ doc ─paginate─▶ pages ─render─▶ HTML ─printToPDF─▶ PDF
.md       ─parse─▶ doc ──────────────────render─▶ HTML ─printToPDF─▶ PDF
```

- **HTML is an export in itself.** Semantic markup with its CSS inside, one
  file that stands alone.
  - A screenplay is paginated first: `<section class="page">` and its
    lines, the margins in CSS.
  - Markdown flows, and the browser cuts its pages with `@page` and
    `break-inside: avoid`. For documents that is enough.
- **PDF is made on the host, not in the window.** The first thought was
  Chromium's `webContents.printToPDF` in main, but the engine is the
  machine's and outlives the window (ADR 0086): a host on a devbox, the
  CLI and an Agent's tool have no window to print with. A device request
  to a window (ADR 0082, decision 12) would fail wherever none is open.
  - So the App's engine part, in Rust, writes the PDF itself. Candidates:
    Typst as a library (layout, fonts, PDF), or a PDF writer such as
    `krilla` or `printpdf` drawing the paginator's lines. A screenplay is
    monospaced lines at fixed places, so the second is enough for it;
    markdown's flow wants a layout engine, so Typst.
  - `printToPDF` stays possible as a client's "Print…", not as the export.
  - A screenplay: Letter or A4, 1.5″ left and 1″ elsewhere, the number top
    right, no number on the title page.
- **One codec, in Rust.** The engine needs the codec to export and to
  count, the CLI to pipe, and the editor in every client (ADR 0089). So
  the Fountain codec and the paginator are written once in Rust and
  compiled to WebAssembly for the client, as the workspaces model is (ADR
  0088's traces). Markdown's codec on each side (`pulldown-cmark` or
  `comrak` in Rust, tiptap's in the editor) is for the ADR to weigh
  against one in WebAssembly.
- **The paginator is the real work**, a pure function
  `paginate(doc) → Page[]`.
  - The face is monospaced (Courier 12 pt) and the columns are fixed
    (action about 60 characters, dialogue about 35), so pages are counted
    by lines, with no DOM and no measuring. afterwriting does so.
  - It keeps the rules CSS cannot: `(MORE)` at a page's foot and
    `(CONT'D)` at the next one's head when a speech breaks; no scene
    heading last on a page; no character torn from their speech.
  - Its tests are plain: lines in, pages out.
  - It also gives counts for free: pages per scene, lines per character.

## 6. Other formats and uses

Picked by three tests, which Fountain passes: it is **plain text** an Agent
writes; a **structured view** beats the bare text; it **reuses** the codec,
the editor, the export or the fenced block.

- **Near what is planned:**

  | Format | What | Why it fits |
  | --- | --- | --- |
  | Slides (markdown as Marp or Slidev, `---` between slides) | A deck from `.md` | The markdown codec and the same PDF and HTML export; nearly free |
  | Mermaid or D2 | Diagrams in a fenced block | Agents write them well; drawn beside their source |
  | Kanban in `.md` (headings are columns, `- [ ]` are cards) | A board of tasks | Obsidian Kanban's form; readable without Banda |
  | Collections (a folder of `.md` with frontmatter: a file is a row, a field a column) | Notion's databases | Notion's main feature on plain files; the largest of all |

- **The screenplay's neighbours:** a stage play or an audio drama (the same
  Fountain, another layout on export); an AV script in two columns, what is
  seen and what is heard, for video and podcasts; subtitles, `.srt` and
  `.vtt`, which can come from Fountain.
- **Spatial:** JSON Canvas (`.canvas`, Obsidian's open spec), a board of
  cards and arrows; Excalidraw (`.excalidraw`), sketches.
- **For developers:** notes whose code blocks run in a Terminal, a light
  Jupyter; `.http` files whose requests run from the document.
- **What only Banda can do:**
  - **A block to a Thread.** Pick a paragraph or a scene and send it to an
    Agent as a chip (ADR 0015).
  - **An Agent's edits as suggestions**, by block, with their author,
    accepted or declined (§7.3).
  - **A Kanban card starts a Thread**, and its state is the Agent's:
    waiting or working, as on the bar (ADR 0035).
  - **For a screenplay:** the Agent breaks a scene down into places,
    characters and props (a collection or a CSV); draws a frame per scene
    as a storyboard (Visuals, ADR 0037); a read-through by roles in
    voices; the counts of §5.
  - **The Agents' own files**, `AGENTS.md`, `SKILL.md`, the ADRs: the
    frontmatter as a form, the text as a document.
- **What to take first:** slides (almost nothing new, a visible feature);
  Mermaid in fenced blocks (small, and it proves embedding, which
  ` ```fountain ` needs later); Kanban tied to Threads (the most Banda of
  them). Collections and Canvas are the next big step, each an App or an
  ADR of its own.

## 7. With Files and Git, the UNIX way

The new architecture's borders are Unix's (`architecture.md`, "one job
each, text protocols"; ADR 0082; `2026-11-06-architecture-vision.md` §4):
four kinds of message (query as `read(2)`, command as argv and an exit
status, fact as syslog and inotify, stream as a pipe), an intent as
`xdg-open`, a byte URL or a pass as a file descriptor. Apps never read
another App's tables and never import one another. They meet in
**files**, **intents**, **calls** and **published facts**. A document App
adds no tree, no history and no storage of its own: Files has the tree,
Git has the history, the folder has the data.

### 7.1 The App as a program

In the vision's table of first-party Apps (§4.1), it would read so. Its
name is `docs` here only for want of one (§8).

| App | Provides | Needs |
| --- | --- | --- |
| `docs` | query `outline { path }` (scenes, headings), `stats { path }` (pages per scene, lines per character); command `export { path, to: "pdf" \| "html" }` with a receipt, its work reported by fact `docs.exported@1`; previewers for `.md` and `.fountain` | calls `files.read`, `files.write` (or `files:rw` and the kernel's path guard, §7.4); `bytes` for the editor's pictures; listens `threads.turn.ended@1` and `git.committed@1` for §7.3 |

- **`banda call` can drive it**, the vision's test of a deep module:
  `banda call docs.export '{"path":"film.fountain","to":"pdf"}'` works from
  a shell, on a devbox, with no window.
- **The codec is a filter too.** A CLI form such as
  `banda docs parse < film.fountain` printing JSON, and `serialize` back,
  makes the format usable by any program, as `jq` and `pandoc` are.
- **An export never hangs** (ADR 0082, decision 4): the command answers at
  once and the PDF is reported by a fact, which Files' activity and the
  bar's notices hear.
- **The Gateway gives an Agent** `outline`, `stats` and `export` as tools.
  It writes the documents themselves as files, as it writes code.

### 7.2 Files: the tree, the reading and the writing

- **Files draws a kind of file by a previewer** (ADR 0073, decision 6).
  - The document App declares previewers for `.md` and `.fountain`, with
    `can: edit` and a priority above Files' own markdown view (Streamdown
    with a Source toggle). A Fountain previewer is new.
  - So the Person opens a document from Files' tree, from Quick Look, from
    a path in a reply (ADR 0063) or from the Banda menu, and gets the
    editor. "Open with…" still offers Files' plain view.
  - `load` is a lazy import: the editor costs nothing until a document is
    opened.
- **It saves with `files.write { path, text, base }`** (ADR 0073, decision
  8).
  - The write carries the hash the text was read at, so an Agent's write
    in between is never lost: the bar "Changed on disk by the Agent",
    with Compare, Take theirs and Keep mine, is Files' already.
  - The editor needs a merge that Files lacks only if both sides edited.
    A three-way merge by block is the open part.
- **`show.file@1` is Files'**, so a path anywhere opens through Files, and
  Files picks the document App's previewer. The document App handles no
  intent of its own to open a file.

### 7.3 Git: the history and an Agent's edits

- **Git keeps the history.**
  - A document's history is `git log` for its path; Files' `files.info`
    already reads the last commit.
  - **An Agent's edits as suggestions come from Git, not from a track
    changes of our own:** the text at the turn's checkpoint (the Git App's
    checkpoints) against the text now, drawn by block in the editor.
    Accept keeps a block, Decline writes the checkpoint's block back.
  - **A diff of prose.** Git's diff is by line; a document reads better by
    block, and a screenplay by scene. Either the Git App's diff asks the
    document App to draw a `.md` or `.fountain` hunk, or the document App
    handles an intent such as `show.diff@1` for its kinds. `show.diff@1` is
    the Git App's, and in v1 one App handles a verb (ADR 0082, decision
    17), so a prose diff is a previewer-like hook the Git App asks for, or
    waits for intents with several handlers. This is for the ADR.
- **Facts it hears:** `threads.turn.ended@1` (a turn's edits are ready to
  show as suggestions) and `git.committed@1` (the suggestions are taken).

### 7.4 The pipe end to end

```
Agent writes film.fountain ──▶ Files (files.activity) ──▶ editor reloads, by block
Person types ──▶ docs editor ──files.write{base}──▶ disk ──▶ Git status, diff
turn ends ──threads.turn.ended@1──▶ docs: checkpoint vs now = suggestions
banda call docs.export ──receipt──▶ engine writes film.pdf ──docs.exported@1──▶ Files, notices
```

- **Export writes files**: beside the source, so Files shows the PDF with
  its own previewer and Git sees it, or ignores it by `.gitignore`.
- **Items:** the App lists recent documents as Items (ADR 0082), so the
  sidebar and the Banda menu find them.
- **Open for the ADR:**
  - Does the App call Files' `files.read` and `files.write`, so one writer
    keeps the `base` rule, or hold `files:rw` itself under the kernel's
    path guard? Calling Files is the more Unix: one program owns the disk's
    edge.
  - Where the editor's merge lives when both the Person and an Agent
    changed a block.
  - How a prose diff reaches the Git App (§7.3).

## 8. A name

The App names in Banda are plain words: Threads, Browser, Git, Files,
Terminal, Usage, Pulls (GLOSSARY, App). A document App's name could follow
them, or the App could have a name of its own.

- **Plain words:**
  - **Docs.** Clear, but near "Person document" in the GLOSSARY and the
    repo's `docs/`.
  - **Pages.** Clear, but near "pages in the Thread" (ADR 0037's research).
  - **Write.** A verb, as the App is used. Near `files.write`.
  - **Notes.** Says less than it does: screenplays and slides are not
    notes.
  - **Paper.** Pages, print, PDF, the screenplay's page. Dropbox Paper
    exists.
- **Names of its own, Ukrainian as Banda is:**
  - **Pero** (перо, a quill). Short, said alike in any language, and
    writing is what it does.
  - **Arkush** (аркуш, a sheet). A page, and the screenplay's sheet.
  - **Zoshyt** (зошит, an exercise book). Warm, but hard to say outside
    Ukraine.
- **Open:** a plain word in Banda's list, a name of its own, or both: a
  plain word in the list and a name if it ever stands alone.

## 9. Steps, if the ADR takes this

1. An ADR: two kinds of file, the codecs, export on the host (§5), the
   App as a program beside Files and Git (§7), its name. GLOSSARY gains
   Document and Screenplay.
2. The Fountain codec in Rust, with its round-trip tests on a corpus, and
   its WebAssembly build.
3. The editor's previewers: tiptap with the screenplay's schema, Enter and
   Tab between blocks, names suggested.
4. The paginator, then export to HTML and PDF.
5. Markdown's editor in the same steps. Then slides, Mermaid, and
   ` ```fountain ` inside `.md`.
