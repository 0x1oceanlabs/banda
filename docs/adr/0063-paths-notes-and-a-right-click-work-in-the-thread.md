---
status: accepted
date: 2026-11-05
---

# Paths, notes and a right click work in the Thread

On 2026-11-05 Roma tried the Thread as ADR 0058 left it, with a reply
that used every kind of markdown. Three things did not work: a footnote
does not take you to its note, a path such as `src/thread/Message.tsx:42`
is plain code, and a right click does nothing, either in the Thread or in
the composer. Selecting text to Quote it works and is liked. Roma asked
to fix these, and to gather what else makes working in the chat
pleasant.

The evidence comes from four places:

- a trial of `main` with the fake agent;
- T3 Code's source, at `337c585`;
- the docs of the Codex app, Claude Code Desktop and Cursor;
- the Files research for ADR 0034's step 5 (not yet merged), on paths in
  replies.

What the trial showed:

- **Footnotes.** `MarkdownLink` gives every link `target="_blank"`, a
  note's `#` link too. A click asks for a new window, which the desktop
  refuses, so the note never comes into view. Streamdown keeps a reply
  that has notes in one block, so the notes do sit at its end. But every
  reply names its notes the same, `user-content-fn-1`, so two replies
  with notes share their ids.
- **Paths.** No path in a reply is a link. A Markdown link to an absolute
  path is drawn as a link but opens nothing (#492). A relative one is
  shown as "[blocked]" by rehype-harden.
- **Right click.** Neither the Thread nor the composer answers one. The
  terminal has its own menu, with Paste going through main
  (`edit.paste`), because the page never reads the clipboard.

**Decision.** Roma decided the points marked _decided_ on 2026-11-05. The
rest are our defaults, and they stay his to change.

1. **A note is one click away, and back.**
   - A `#` link in a reply never opens a window. It scrolls the Thread
     to its target in the same reply, centres it, and lights it once
     (1 s, `--primary` at 14%). The note's ↩ goes back to where it was
     cited.
   - Each reply's ids are its own, so two replies' notes never mix.
   - Hovering or focusing a citation shows its note in a tooltip.
   - The notes sit under a rule, at the meta size (ADR 0058, decision 1),
     under the label "Notes".

2. **A path in a reply is a link to its file.** (_decided_: shown as the
   Agent wrote it, and in plain text too, but only to a file that
   exists.)
   - **What counts:**
     - inline code that reads as a path, by T3 Code's rule: no spaces,
       and a `/` or a `:line`, and not a host, a port or a version;
     - a Markdown link to a path, a `~/` path or a `file://` URL;
     - a path in plain text that has a `/` and a file's extension.

     A line is written `:12`, `:12:3`, `#L12` or `#L12C3`.
   - **Only a file that exists becomes a link.** The window's main process
     checks all of a reply's paths in one call:
     - A relative path starts at the Thread's folder.
     - If no file is there, it starts at a folder the Thread's tools
       worked in, by the paths its tool calls named. A worktree beside
       the Space then works, as #492 asks.
     - Anything else stays as it was written.
   - **The look** (_decided_: A):
     - Inline code keeps its chip, with a file icon, the folder dimmed,
       the file's name bright and a thin `--primary` underline.
     - A path in plain text is only underlined.
     - A named Markdown link keeps ADR 0051's look, with the file's name
       in quieter text where a page shows its host.
     - Hovering shows the full path, the line, and what a click does
       (`linkHint`).
   - **A click opens it in Banda. Ctrl, or ⌘, with a click opens it in
     its app** (`file.outside`), as a path in a terminal does.
     - "In Banda" means the browser's tab, as the terminal does it today,
       until Files (ADR 0034, step 5) has `files.file`. From then on it
       means `files.file` at the line.
     - The paths are found in `@banda/ui`, so Files' link claims take this
       code over instead of writing it again.
   - **A file that has gone since** says so in a toast ("No such file:
     …").
   - **Unchanged:** web links (ADR 0051), links in a Visual, and any
     scheme other than a file's.

3. **A right click opens Banda's menu in the Thread and in the
   composer.**
   - It is `@banda/ui`'s `ContextMenu`, like the terminal's and the
     sidebar's, and not Electron's own menu. It looks like the rest of
     the window, glass included.
   - What is under the pointer chooses the items, and the first match
     wins:
     - **Text selected in a reply:** Copy, Quote in reply, Find "…" in
       Thread, Search the web (Banda's browser, with `browser.toml`'s
       search).
     - **A path:** Open in Banda, Open in its app, Show in folder, Copy
       full path, Copy relative path (with its `:line`), Add to message
       (an `@` chip in the composer).
     - **A web link:** Open in Banda, Open in external browser, Copy
       address.
     - **An image:** Open, Copy image.
     - **A code block:** Copy code, Wrap lines, Run in terminal
       (decision 6).
     - **The Agent's reply:** Copy reply (Markdown), Copy as plain text,
       Quote reply, Fork from this response, Select reply.
     - **The Person's message:** Copy message, Edit from here.
     - **The composer:** Undo, Redo, Cut, Copy, Paste, Paste as plain
       text, Select all. Each is dimmed when it has nothing to act on.
   - Paste goes through main as the terminal's does (`edit.paste`), and
     plain paste the same way (`edit.paste-plain`, Electron's
     `pasteAndMatchStyle`). The page still never reads the clipboard.
   - Items show their keys. Escape closes the menu, and the focus goes
     back where it was.

4. **Copying from a reply copies Markdown** (_decided_). A selection
   copies as Markdown in `text/plain`, with its code fences, links,
   lists and emphasis, and as clean HTML in `text/html`, as T3 Code does.
   A path's chip copies as the Agent wrote it.

5. **Ctrl, or ⌘, with + − 0 sizes a Thread's text** (_decided_), as it
   zooms a terminal: the steps of `@banda/ui/lib/zoom`, the Pane's own
   until the window starts again, with a badge for a second. It sizes
   the reply, the Person's messages and the code. The Pane's header, the
   work lines and the composer's controls keep their size.

6. **A code block can wrap its lines and run its command** (_decided_).
   - **Wrap lines** sits in the block's actions (ADR 0058, decision 3),
     off by default.
   - **Run in terminal** is offered on a block of one line in a shell's
     language (`bash`, `sh`, `zsh`, `shell`, or `console` with its `$ `
     taken off). It opens a terminal Pane beside the Thread, in the
     Thread's folder, and runs the line, as T3 Code does. The Person
     pressed Run; an Agent cannot press it.

7. **Not now.**
   - Spellcheck in the composer (_decided_ against: on Linux, Electron
     fetches its dictionaries from Google).
   - A key that copies the last reply. The Codex app's ⌘⇧C copies the
     folder, and ChatGPT's key is gone.
   - The Person's message sticking at the top while its reply scrolls.

**Build order.** One PR each:

1. Notes (decision 1).
2. The right click in the Thread and the composer (decision 3), without
   the items for paths and code blocks.
3. Paths (decision 2) and their items in the menu. This closes #492.
4. Copying Markdown, the text's size, and the code block (decisions 4–6).

**Consequences.**

- `MarkdownLink` owns `#` links and file links as well as web links. The
  Thread supplies the opener and the path check through context, as it
  supplies the web opener (ADR 0051) and local media.
- The agents module's desktop part answers a `paths` call beside `media`.
  The engine is unchanged, so the folders a Thread's tools worked in come
  from its diffs and the full paths in its tools' titles.
- The window gains `edit.paste-plain` beside `edit.paste`.
- A Pane's link to a file opens it through one action, `file.open`, as
  `file.outside` opens it outside; a terminal's path does too. Each says
  in a toast when the file has gone.
- When Files lands, "Open in Banda" moves from the browser's tab to
  `files.file` inside `file.open`, and nothing else changes.
- Copy reads the selected page back into Markdown and HTML
  (`@banda/ui/lib/markdown-copy`, with hast-util-to-mdast). What the page
  draws but the Agent did not write, such as a link's host or a file's
  name, cannot be selected and is not copied. What the page shows in its
  own way keeps what was written on its outer element: a local image its
  path, a link to a file its address, a diagram its source.
- The Markdown drops rehype-harden. Streamdown lets every prefix and
  scheme through it, so it only blocked a path to a file; the sanitizer
  still keeps a link's and an image's schemes to the web's.
