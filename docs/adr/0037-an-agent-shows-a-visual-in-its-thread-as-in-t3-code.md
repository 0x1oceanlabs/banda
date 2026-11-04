---
status: accepted
date: 2026-11-02
---

# An Agent shows a Visual in its Thread, as in T3 Code

Roma asks Agents for mockups, how a feature works, how an animation or
a Pane will look, and how a sound plays. Agents make all of these as one
HTML page. T3 Code shows that page inside the chat, above the Agent's
reply: the Person sees it, plays it and hears it where they read. Banda
can't: a Thread shows text, code and tables, and an Agent's page opens
only as a file in a browser Pane, beside the chat, in its own colours.

The evidence is in
[pages in the Thread](../research/2026-11-02-pages-in-the-thread.md)
(T3 Code at `ac8dce0c`). In short:

- T3 gives every Agent two MCP tools. `html_preview` lays the page out in
  a headless browser and answers a picture of it, its height and its
  console. `html_render` keeps the page and shows it in the thread.
- The page runs in a sandboxed frame with an opaque origin, on the
  thread's own background. It paints with the app's colours through CSS
  variables (`--background`, `--chart-1`…), which follow light and dark
  live. It tells the app its height, so the frame fits it.
- An instruction teaches each Agent when to use them: a visual the Person
  asks for, or data with a trend, is previewed, then shown. No server is
  started for it. A picture to post elsewhere is a `.png` file.
- Markdown in the chat shows images, video and audio from a file's path,
  Mermaid diagrams and math.

**Decision.** Roma decided the points marked _decided_ on 2026-11-02
("делай как в т3"). The rest are our defaults and stay Roma's to change.

1. **A Visual is a Thread item** (_decided_: as in T3).
   - A **Visual** is one finished HTML page an Agent made to show its
     Person something, such as a mockup, a chart, a diagram, an animation
     or a sound. It shows in its Thread where the Agent showed it: before
     its reply, since the tool runs before the reply is written.
   - It belongs to the agents module, as the Thread's other items do. The
     Thread's Pane follows only that module's facts, and a Visual's page
     is kept like a message's images: the file in the Space's data, a row
     in the module's tables, and a fact, `visual.shown`, in the log.
   - Its item is `Body::Visual { visual, title, height }`. Its author is
     the Agent that showed it, in the turn that runs. A fork copies it
     and a rewind takes it away, as with any item (ADR 0027). Its file
     stays with the Space's data, as an image's does.
   - The glossary gains **Visual**. It is not a "page": that word is the
     browser's.

2. **Two tools, as T3's, under Banda's names** (_decided_: "с проверкой",
   so both come first).
   - `preview_visual {html, width?, appearance?}` lays the page out in the
     window and answers its picture as an MCP image, its `height`, its
     console's errors and warnings, and the images it could not find. It
     shows nothing to the Person and keeps nothing. It is `Read`.
   - `show_visual {html, title, height}` keeps the page and shows it in
     the Agent's own Thread. It answers in a line, T3's: "Shown to the
     Person above your reply. Don't describe it; say only what it
     doesn't." It is `Write`, on the Agent's own Thread only, so plan
     mode may use it.
   - Only a Thread's Agent may call them: a Person's call is refused, as
     there is no Thread to show it in.
   - Their rules are T3's, in the tool's own description:
     - a whole HTML document, inline `<style>` and `<script>`, up to
       512,000 characters;
     - no background, card, border, title or side padding on `html` and
       `body`: the Visual sits on the Thread;
     - the window's colours as CSS variables, not fixed colours;
     - charts have fixed pixel heights;
     - no `vh` units and no `height: 100%`, refused with why: the frame
       grows to fit the page, so the page would grow again and again.
   - A height is 80 to 2,000 pixels as the Agent gives it. The frame then
     fits the page's own height, up to 20,000.

3. **The window lays a Visual out for the check; nothing is downloaded.**
   - T3 downloads a headless Chrome for `html_preview`. Banda's window
     has Chromium already. The agents module gets a part in the window's
     main process (`modules/agents/desktop`, ADR 0028), and
     `preview_visual` asks it through the kernel's road (ADR 0029,
     decision 2).
   - It loads the page in a window of its own, never shown, at the width
     asked (240 to 1,600, 728 by default) and in the look's colours for
     the appearance asked (dark by default). It has its own throwaway
     session, its sound muted, and no new windows.
   - Once the fonts are ready and two frames have painted, it reads the
     page's height and takes its picture (at most 4,000 pixels tall). It
     keeps what the console said: errors and warnings, 20 at most, each
     cut at 500 characters. It gives up after 20 seconds.
   - With no window open, the tool refuses, as the browser's do: "Banda's
     window is not open. Nothing was done."
   - **`said` gains an image kind** for this. An engine method's answer
     can carry images, which `banda mcp` passes on as MCP `image` blocks
     beside its text. ADR 0029's screenshots use the same kind later.

4. **The frame keeps the page apart from Banda** (_decided_: a page may
   load from the web, as in T3).
   - The window serves a Visual at `app://visuals/<space>/<visual>`: the
     `app` scheme, on a host of its own, so it is an origin apart from
     Banda's page. Main fetches the page from the engine, as an API
     client (ADR 0029), and nothing else is served there.
   - The response says `Content-Security-Policy: sandbox allow-scripts
allow-forms allow-popups allow-downloads`. The frame says
     `sandbox="allow-scripts allow-forms"`, and never `allow-same-origin`.
     So the page runs its scripts and animations, but gets no cookies, no
     storage, no Banda API and no Node.
   - A page may load fonts, scripts and images from the web, as T3's may.
     Banda's page adds `frame-src app://visuals` to its own CSP.
   - **Local images** a page names by an absolute path are put into it as
     `data:` URLs when it is kept or checked. A file counts only if its
     first bytes say it is an image, so a renamed secret is not inlined.
     The limits are 10 MiB per image and 25 MiB per page. An image not
     found refuses the show and is listed by the check.
   - What the page says to the window is read only from its own frame:
     its height, at any time; a key, with the frame focused; a link,
     with the frame focused and just clicked. A link opens as Banda
     opens links. Keys keep working after the click’s transient
     activation expires. Only Esc and Ctrl or ⌘ with + − 0 pass.
   - Sound needs a click in the frame, as in T3: Chromium's own rule.

5. **A Visual wears the look, and follows it.**
   - The window passes the page T3's variable names, so what an Agent
     learned in T3 works here: `--background`, `--foreground`, `--card`,
     `--popover`, `--muted`, `--secondary`, `--border`, `--input`,
     `--ring`, `--primary`, `--accent`, `--destructive`, `--warning`,
     `--success`, `--info`, `--code-background` (most with
     `-foreground`), `--chart-1` to `--chart-6`, `--radius`,
     `--font-sans` and `--font-mono`.
   - Each comes from the look's tokens. A colour the look has no token
     for takes the nearest: `--success` is `--added`, `--warning` is
     `--attention`, and `--chart-6` repeats `--chart-1`.
   - A base sheet comes first, so the page can override it: a transparent
     background, the look's text colour and font at 14 px, an 8 px
     gutter for focus rings and shadows, and no scrollbars.
   - The window posts the variables again whenever the look changes,
     light or dark too, and the page repaints with no reload. It uses the
     message names of MCP Apps (`ui/notifications/host-context-changed`,
     `ui/notifications/size-changed`, `ui/open-link`), as T3 does, so the
     same frame can host MCP Apps later.

6. **A Visual opens as a preview, or as a Pane** (_decided_: "2 варианта
   предпросмотр и пане").
   - In the Thread, a Visual shows with its title, and two buttons on
     hover: **Preview** and **Open as Pane**.
   - **Preview** lays it over the window, as T3's full screen does: as
     wide as it needs, zoom from 50 to 200 %, `Esc` to close.
   - **Open as Pane** opens it in a Pane of its own, `agents.visual`,
     beside the Thread, the way the Thread opens a diff. It fills the
     Pane and scrolls inside it, and it lasts as the Panes do.

7. **Agents learn it from the Banda skill.** Banda sends no system prompt
   over ACP; the skill's core is the MCP `instructions` (ADR 0012). The
   core gains T3's rule, in Banda's words:
   - Show a visual the Person asks for, and data with a trend or a
     comparison, as a Visual: `preview_visual`, then `show_visual`. A
     visual in a file is shown by passing that file's HTML.
   - Never start a server for it, and never describe it after.
   - A picture to post, send or use elsewhere is a `.png` file and its
     path, not a Visual.
   - Ordinary coding work needs neither tool.
   - _Amended 2026-11-03, after the step 5 trial:_ Claude Code keeps
     only the first 4,096 characters of a server's `instructions`, and
     the core is longer, so the rule never reached it. `banda mcp` now
     says a brief of its own as its `instructions` (`modules/skill/
     BRIEF.md`, tested to fit): what Banda is, this rule, and the `skill`
     tool for the core and its topics. This changes ADR 0019's "the
     skill's core is the server's MCP `instructions`"; `banda skill` and
     the exported skill still start with the core, which holds the rule
     too.

8. **Markdown shows media, diagrams and math, as T3's** (_decided_: as
   in T3).
   - `![name](/an/absolute/path)` in a reply shows by the file's
     extension. An image opens larger on a click. A video gets the
     player. A sound gets a small play button with its progress. A file
     of any other kind becomes a link to it.
   - A relative path is resolved against the Thread's Space folder; an
     absolute path names a file on this machine. Spaces in a path are
     supported through markdown's angle-bracket destination syntax.
   - The window serves such a file at `app://files/<token>`. The token is
     signed by main, lasts an hour, and names the file by its real path,
     its device and its inode. Every request checks them again. Only the
     extensions T3 previews are served. Paths in `~` and on the network
     are refused. Banda's CSP gains `img-src` and `media-src` for it.
   - Mermaid diagrams and math (KaTeX) render, with Streamdown's own
     plugins `@streamdown/mermaid` and `@streamdown/math`.
   - A tool's result that carries an image keeps it (`ToolContent::Image`,
     today dropped in `acp.rs`), and shows it when its line is opened.

**Build order.** One PR each. Each step is tried in a real window and,
with Roma's go for the paid calls, by a real Claude Code and Codex.

1. A Visual in the Thread: `show_visual`, `Body::Visual`, `visual.shown`,
   the kept file and `agents.visual`; the agents desktop part serving
   `app://visuals`; the frame with the look's variables, its height and
   its links.
2. The check: `said` with images; `preview_visual` in a window never
   shown.
3. Local images inlined, the limits, the refusals (`vh`, missing
   images); the frame's height known before it loads, from layouts at
   several widths, as T3's.
4. Preview over the window, and the `agents.visual` Pane.
5. The skill's rule and the tools' descriptions, with a real-Harness
   trial of when Agents use them.
6. Markdown media from a path, through `app://files`.
7. Mermaid and math.
8. Images in tools' results.

**Consequences.**

- The agents module gains a part in the window's main process, and main
  routes the `app` scheme by host: Banda's page, `visuals` and `files`.
- The glossary gains **Visual**; GLOSSARY's Thread lists it among its
  items.
- A Visual may load from the web, so a page can tell a server that it
  was opened. That is T3's trade too. A Visual is still kept apart from
  Banda's API, the Person's cookies and their files.
- An Agent that runs without Banda's window open can't check its
  Visuals, but it can show them; the Thread shows them when it is
  opened.
- The same frame and messages can host MCP Apps' `ui://` pages later
  ([hackable modules](../research/2026-11-01-hackable-modules.md),
  Option B).
