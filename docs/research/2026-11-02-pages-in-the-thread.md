# Pages in the Thread: how T3 Code shows an Agent's HTML, images, sound and charts in chat

- **Why:** Roma often asks Agents for mockups, how a feature works, how an animation looks or how a sound plays. Agents make these as HTML. T3 Code shows that HTML inside the chat, and Banda can't. This note looks at how T3 does it and what Banda would need.
- **Source:** github.com/pingdotgg/t3code, clone at `/tmp/t3src/t3code`, commit `ac8dce0cc3abd8a337f2d806b5082a6834b9b81a` (2026-11-02). Nothing from T3 was run except its two tools, called from a T3 thread as a check (section 6).
- **Banda:** `origin/main` at `66c96c1`.
- **Marks:** **V** = verified, read in code. **I** = inferred, our reading.

## 0. What T3 shows, in one table

| In the chat | T3 Code | Banda today |
|---|---|---|
| A finished HTML page inline (`html_render`) | yes | no |
| A check before showing it (`html_preview`: PNG, height, console) | yes | no |
| Image from `![](/abs/path.png)` | yes | blocked by CSP (`img-src 'self' data:`) |
| Video and audio from `![](/abs/path.mp4)` / `.mp3` | yes | no |
| Mermaid, math (KaTeX) | yes | Mermaid off, no math plugin |
| Link to a file opens a viewer (html, pdf, csv, office, fonts, zip) | yes | `.html` only in a browser Pane |
| Images in a tool's result (screenshots) | yes | dropped (`acp.rs:1453-1472` keeps text, diff, terminal) |
| Charts | through `html_render` only, no chart library | none |

## 1. `html_render`: the page in the chat

### 1.1 The two tools (V)
Both are MCP tools on T3's own MCP server, defined in `apps/server/src/mcp/toolkits/html/tools.ts`.

- **`html_preview`** (`:26-70`):
  - Takes `html` (a whole document, up to 512,000 chars), `width` (240–1600, default 728, about 390 for a phone) and `appearance` (dark or light).
  - Returns `contentHeight`, `consoleMessages`, `missingImages` and a PNG as an MCP `image` block (`McpHttpServer.ts:677-757`).
  - The Agent sees its own page before the Person does, and fixes errors from the console.
- **`html_render`** (`:73-106`):
  - Takes `html`, `title` and `height` (80–2000; the Agent passes `contentHeight` from the preview).
  - Saves the page and returns a small reference `{htmlRender:{attachmentId,title,height,heights}}`.
  - The answer tells the Agent: *"Shown to the reader above your reply. Don't mention or describe the page; reply with only what it doesn't already say."* (`handlers.ts:39-52`).
  - It only touches the caller's own thread, so plan mode and read-only sandboxes may call it (`tools.ts:72`).

### 1.2 Rules the tool description gives the Agent (V, `packages/shared/src/htmlRender.ts:224-238`)
- No background, card, border, title banner or side padding on `html`/`body`; the page sits on the thread's own background.
- Use theme CSS variables, not fixed colours: `--background`, `--foreground`, `--muted`, `--card`, `--border`, `--primary`, `--accent`, `--destructive`, `--warning`, `--success`, `--info`, `--chart-1..6`, `--radius`, `--font-sans`, `--font-mono`, and others.
- Charts get fixed pixel heights. No `vh` units and no `height:100%`: the frame grows to fit the page, so these would grow forever. The server rejects them (`HtmlRender.ts:82-94`).
- Local images given as absolute paths are inlined as `data:` URLs. The file type is checked by its magic bytes, so a renamed secret can't be inlined (`HtmlRender.ts:158-196`). Limits: 10 MiB per image, 25 MiB per page.

### 1.3 The headless check (V, `apps/server/src/htmlRender/`, `preview/PreviewBrowser.ts`)
- A pinned `chrome-headless-shell` is downloaded on first use (hash-checked). Until then the tool answers "installing, try again in a minute".
- Flags: no GPU, audio muted, no new windows, WebRTC removed. Traffic goes through a proxy that blocks loopback and private networks, so a page can't reach local services.
- Height: it waits for fonts and two animation frames, then reads `scrollHeight`.
- At publish it also lays the page out at 9 widths (320 to 1144). The frame then has the right height on any window width before the page has loaded.

### 1.4 How it reaches the thread (V)
1. The page is written as a file next to the thread's attachments (`HtmlRender.ts:418-436`). Only the small reference stays in the tool result.
2. The web app turns a finished `html_render` tool call into its own timeline row, `kind: "html-render"`, instead of a work line (`apps/web/src/session-logic.ts:698-712`).
3. It shows "above the reply" simply because the tool runs before the Agent's last message. There is no special ordering.
4. If a harness loses or summarises the MCP result, the server keeps the last 64 references per thread and puts them back (`McpProviderSessions.ts:13-26`, `provider-acp/src/server/adapter.ts:3843-3876`).

### 1.5 The frame (V, `apps/web/src/components/chat/HtmlRenderFrame.tsx`, `files/BrowserDocumentFrame.tsx`)
- An `<iframe>` loads a signed URL, not `srcdoc`.
- `sandbox="allow-scripts allow-forms"`. Never `allow-same-origin`, so the page has an opaque origin: no cookies, no storage, no app APIs.
- The server adds `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads` to the response (`apps/server/src/guest/http.ts:60-64`). Modals are left out because "Agent HTML can open without a click".
- There is no network CSP: a page may load anything from the web (fonts, Chart.js from a CDN). Third-party MCP Apps get `default-src 'none'` instead.
- Scripts, CSS animation and WebAudio work. Sound needs a click inside the frame, since there is no `allow="autoplay"` (I).
- **Bootstrap script** injected into the page (`shared/htmlRender.ts:372`):
  - Takes the theme from the URL fragment for the first paint.
  - Listens for theme changes, so light/dark and palette edits repaint live without a reload.
  - Reports its height through a ResizeObserver.
  - Turns link clicks, image clicks and a few app shortcuts into messages to the app.
- The message names come from MCP Apps (`ui/notifications/size-changed`, `ui/notifications/host-context-changed`, `ui/open-link`).
- **Messages from the page:** only accepted from that frame's own window. Links and keys also need focus plus a recent user gesture.
- **"Open full screen"** opens a dialog with zoom from 50% to 200%. There is no copy or save button.

### 1.6 How Agents learn to use it (V, `packages/provider-core/src/server/orchestrationInstructions.ts:21-23`)
The instruction T3 adds to every session:

> Answer data with a trend or comparison with a chart, and show any visual the user asks for here: pass its HTML to `html_preview`, then `html_render`. If the visual is a file, pass that file's HTML. A screenshot on disk or a text description does not show it. Never start a server for it. ... Asked for an image to post, send, or use elsewhere: a `.png` file and its path, never `html_render`.

- **Claude Code** gets it in the system prompt.
- **Codex** gets it as `additionalContext` (4 KB per entry).
- **ACP** has no system prompt, so it is wrapped around the first prompt as `<t3_code_instructions>`.
- T3 has evals for this (`evals/mcp-tool-use/cases/visual-preview.ndjson`):
  - preview always comes before render;
  - the Agent never starts `http.server`;
  - the page uses `var(--…)`, not `#000`;
  - latency data gets a chart without being asked;
  - an image to post goes out as a PNG;
  - plain coding tasks call neither tool.

## 2. Media, diagrams and files in markdown (V)

- **Renderer:** T3's own unified/remark/rehype pipeline (`apps/web/src/components/chat/markdownRenderer.ts:52-58`), with remark-gfm, rehype-raw and rehype-sanitize. It is not Streamdown.
- **`![x](/abs/path)`:**
  - The file type comes from the extension (`packages/shared/src/mediaPreview.ts`).
  - Images open in a lightbox. Video uses `<video controls>`, loaded only once it scrolls into view. Audio gets a small play chip with progress.
  - A local path never reaches the browser as a path. The client asks the server for a signed, one-hour URL `/api/assets/<token>/<name>` (`apps/server/src/assets/AssetAccess.ts:354-433`, `:554-582`).
  - The token pins the file's device and inode, and every request re-checks the real path.
  - Any file on the machine whose extension is on the preview list may be served this way, not only workspace files.
- **Mermaid:** fenced ` ```mermaid ` blocks render with the `pele` library, cleaned with DOMPurify. **Math:** remark-math plus KaTeX.
- **No chart library.** Charts are meant to go through `html_render`.
- **File links** become chips that open the right-panel file viewer:
  - `.html` in a sandboxed frame; sibling css/js/images load when the file is inside the workspace;
  - `.pdf` with PDF.js;
  - csv as a table, markdown rendered, `.mmd` as a diagram;
  - office files, fonts, zip and sqlite with their own viewers.
- **Tool results:** image blocks are kept and shown when the tool row is opened (`client-runtime/src/work-log/itemDetail.ts:200-210`).

## 3. MCP Apps, the standard next to it (V)

- T3 also hosts **MCP Apps** (`io.modelcontextprotocol/ui`, `ui://` resources, `text/html;profile=mcp-app`) in `chat/McpAppFrame.tsx`. These are UIs that third-party MCP servers ship with their tools.
- They get a strict CSP (`default-src 'none'`, plus only the domains the tool declares) and a full JSON-RPC bridge (`tools/call`, `ui/message`, display mode). Tool calls that write, and messages into the chat, need the Person's yes.
- `html_render` borrows only the message names for theme, size and links.
- So the same frame code can later host both kinds of page. Banda's `2026-11-01-hackable-modules.md` (Option A/B) already points this way.

## 4. Banda today (V, at `66c96c1`)

- **Markdown:** `app/ui/src/components/markdown.tsx` uses Streamdown 2.7 with the code plugin only (`mermaid: false`, no math). Raw HTML goes through rehype-sanitize, so `<script>`, `<iframe>` and `<style>` are stripped.
- **Window CSP** (`app/desktop/src/main.ts:63-78`):
  - `img-src 'self' data:`, so web images and local paths don't show.
  - No `frame-src`, so a frame may only load `app://` pages.
  - `app://` serves the built web folder and the wallpaper only (`main.ts:326-350`).
- **What the Thread keeps:**
  - Only the Person's messages carry images, as `data:` URLs.
  - The Agent's content keeps text only (`modules/agents/engine/src/acp.rs:1381-1392`).
  - Tool content keeps text, diff and terminal (`model.rs:620`, `acp.rs:1453-1472`).
- **MCP module:** `engine/src/mcp.rs`.
  - A method becomes a tool with `, tool "<name>"` on its `methods!` line; the `///` comment is the description.
  - Every result is one text block (`said()`, `mcp.rs:184-187`).
  - The server is already given to every ACP session (`acp.rs:581-593`). A new tool needs no new wiring per Harness.
- **Teaching Agents:** Banda has no system prompt over ACP. The skill core (`modules/skill/SKILL.md`) goes out as the MCP `instructions`, and topic files live in `modules/<m>/skill/`.
- **What works now:** an Agent writes an `.html` file and the Person opens it in a browser Pane (`browser.open {file}` → `file://`). It works, but it is beside the chat, not in it, and the page doesn't follow the Look.

## 5. What Banda would need (I)

Banda has a head start over T3: Electron already ships Chromium. The check before showing (T3's downloaded headless shell) can be an offscreen `BrowserWindow` in the desktop process, reached the way `browser_tabs` reaches the window (`Call::ask_window`). Nothing to download.

The shape, in the order it pays off for Roma:

1. **Page in the Thread (the core).**
   - **Tool:** an MCP tool `show_page {html, title, height}` (name to pick) in the agents module, since the Thread Pane only follows agents events (`live-thread.ts:23`).
   - **Storage:** the engine writes the page to a file under the Thread's state folder, and a new `Body` kind (`page`) holds `{file, title, height}`.
   - **Frame:**
     - A new privileged protocol, for example `banda-page://<thread>/<page>`, serves only those files, with a `sandbox allow-scripts allow-forms` CSP header.
     - The window CSP gains `frame-src banda-page:`.
     - The iframe gets `sandbox="allow-scripts allow-forms"` and never `allow-same-origin`.
   - **Look:** the same variable names as T3 (`--background`, `--chart-1..6`, `--radius`…), filled from Banda's Look tokens. They are posted again on light/dark or Look change, with MCP Apps message names, so an Agent's habits from T3 carry over.
   - **Height** comes from a ResizeObserver message.
   - **"Open as a Pane"** instead of T3's full-screen dialog, since Panes are how Banda shows big things.
2. **Check before showing.**
   - `preview_page {html, width, appearance}` → PNG + height + console, rendered offscreen in Electron.
   - It needs `said()` to carry an image block, which ADR 0029 already promises for browser screenshots. That is one change, used twice.
3. **Teach Agents.**
   - A skill section with T3's rule ("a visual the Person asks for, or data with a trend: preview, then show; never start a server; a PNG to post is a file").
   - The theme and layout rules go in the tool description.
4. **Media in markdown.**
   - `![](/abs/path)` for images, audio and video through a signed `banda-file://` URL that checks the real path, like T3's asset tokens.
   - The CSP gains that scheme for `img-src` and `media-src`.
   - Sounds matter here: ADR 0009 already plays sounds, so Roma could hear a proposed sound right in the Thread.
5. **Mermaid and math.** Streamdown has them as plugins next to `@streamdown/code`: `@streamdown/mermaid` and `@streamdown/math`, both 1.0.3 on npm (V). This is a small step.
6. **Images in tool results.** Keep `ContentBlock::Image` in `acp.rs` and show it in the opened tool line. This is shared with the browser screenshot work.

## 6. Checked live in T3 (V)

From this research thread, T3's own tools were called:
- `html_preview` returned a PNG and `contentHeight` 423 with an empty console.
- `html_render` returned heights for all 9 widths, and the page showed in the chat.
- The page held a table, a CSS animation and a WebAudio button. The animation ran; the sound needs a click.
- `![](/abs/path.png)` and a `.wav` file link were also put in the reply to see how T3 shows them.

## 7. Questions for Roma

1. **Network:** may a page load things from the web (fonts, chart libraries from a CDN), as in T3? Or should it stay offline (`default-src 'none'` + inline only), as for MCP Apps? Offline is safer; open is what Agents expect.
2. **Big pages:** "open as a Pane" instead of a full-screen dialog. Is that right?
3. **Order:** start with step 1 alone (page in the Thread, no preview), or with steps 1+2 together, so Agents check their pages from day one?
