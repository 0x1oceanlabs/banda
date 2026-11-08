# ChatGPT's Space, and what Banda takes from it

How ChatGPT's Space, launched around DevDay at the end of September 2026,
organises pages, chats, files and agents, and what of it fits Banda. It is
read beside the documents research (`2026-11-08-documents-and-screenplays.md`)
(Roma, 2026-11-08: "study how spaces work in ChatGPT, how it is all
organised, and what useful we can take from it").

- **Sources:**
  - OpenAI's own, read 2026-11-08: learn.chatgpt.com/docs/space and its
    `/pages`, `/agents` and `/collaboration`; chatgpt.com/features/space
    (a feature page with an FAQ, marketing copy).
  - Secondhand: eesel.ai's guide (a vendor blog, last edited 2026-09-30),
    Android Headlines (2026-09-30), MindStudio (2026-10-04, commentary,
    least reliable).
- **Limits:**
  - help.openai.com refused every fetch (403): the Space sharing and data
    article, the Projects article, the DevDay recap. So Projects' limits and
    their project-only memory come from eesel alone.
  - learn.chatgpt.com's `/pages` was read only to about 39k of 48k
    characters: the insert menu is confirmed up to Visualize, the blocks
    after it are secondhand.
  - Nothing was used in a browser. Version history, export formats,
    notifications and Trash are described by no OpenAI page read.
  - Below, **(OpenAI)** marks what OpenAI's pages say; **(2nd)** what only
    the others say.

## 1. How Space is organised

- **Two levels.** The **workspace** is the personal or organisation
  environment one is signed in to; **Space** holds the work one can reach
  in it (OpenAI).
  - **A space** groups pages around a topic or a team; a page can also
    stand alone. Each person has a personal one, "Your Personal Scratchpad"
    in OpenAI's example, next to "My Meetings" and "Design studio"
    (OpenAI).
  - **What is in Space:** pages, slides, spreadsheets, **Sites** ("websites
    and tools you build with ChatGPT"), images and files (OpenAI).
  - **Pages nest**: a page has child pages (OpenAI). Folders are claimed
    only by Android Headlines.
- **Space replaced Library**, the old store of files and images, on Pro,
  Business and Enterprise (OpenAI). What Free and Plus get instead is not
  said.
- **Projects stay beside it** (eesel quotes the getting-started guide).
  - A Project holds chats, files and instructions, on every plan (2nd).
  - Its instructions override the global ones; once shared, its memory is
    the Project's only (2nd, from help.openai.com snippets in search
    results).
  - So ChatGPT has two places for a body of work: a Project for chats, a
    space for pages. No OpenAI page read says how one reaches the other,
    beyond a page referring to a chat.
- **The sidebar** (OpenAI): New page, All, Pages, Sites, Images, Google
  Drive, Recents, Spaces, Trash. Lists split into Suggested, Favorites,
  Your items, Shared with you. Templates sit on Space's home (2nd).

## 2. A page

- **From a chat:** "ask ChatGPT to create a page from an existing
  conversation", or New page (OpenAI).
- **Blocks** (OpenAI, the insert menu up to Visualize): headings, lists,
  checklists; table, code, highlight; image and file; page and link to a
  page; **references to Files, Pages and Chats**, which point without
  copying; **Visualize** (interactive calculators, diagrams, screen
  designs).
- **Blocks after Visualize** (2nd, from the truncated part):
  - **Generate**, an inline draft to accept, revise or undo.
  - **Prompt**, a stored request any reader runs with "Chat about this".
  - **Task** and **Agent Instructions**.
  - Quote, divider; a checklist begun by typing `[]`.
- **Slides** turn a conversation into a deck, to present or export; the
  format is not said (OpenAI).
- **Keeping a page current is not there yet.** "Keep Updated isn't
  available at launch"; a recurring update needs a task scheduled from a
  chat, and "writing a cadence in a page … doesn't by itself confirm that
  a task is scheduled" (OpenAI). The feature page promises dashboards that
  stay updated: marketing ahead of the product.
- **Not described by OpenAI:** version history, page export, notifications.
  eesel's related summary says "no export or version history yet" (2nd).

## 3. The AI in a page

- **Four routes** (OpenAI):
  1. **A conversation beside the page.**
  2. **"Ask for change"** on a selection, which shows "the proposed edit
     before accepting it": a proposal.
  3. **Inline `@ChatGPT` or `@dot`** in the page.
  4. **`@` in a comment.** Routes 3 and 4 give "the reply and any changes
     to the page", which the person should "review" afterwards: a write
     first, a review after.
- **Dots** are always-on agents working in the background; texting one is
  to come (OpenAI and 2nd). That they revise pages unasked is MindStudio's
  claim alone, and contradicts Keep Updated's absence.
- **Each person brings their own AI.** Collaborators "may use different
  agents, connected tools, or instructions"; each works through their own
  ChatGPT and memory (OpenAI).
- **Attribution:** a "Show attribution" view, "when available", is eesel's
  alone (2nd).

## 4. People together, and what is seen

- **View, Comment, Edit** (OpenAI). Slides have no comment-only role; a
  Team invitation may lack it too.
- **Access is inherited**: sharing a page shares its child pages, and a
  shared space's access applies to its pages. "Removing a direct invitation
  doesn't remove access that someone still inherits"; the controls show
  direct and inherited access apart (OpenAI).
- **Live co-editing** for those with Edit (OpenAI).
- **Context and privacy** (OpenAI):
  - Sharing a page shares no private chats or personal memory.
  - But what the AI writes on a page is seen by all who can see it,
    "including personal details drawn from memory".
  - Linked files keep their own permissions; what is copied or summarised
    from them onto a page does not.
- **Plans and devices** (OpenAI): Pro, Business and Enterprise. Web and
  desktop edit; mobile finds, reads and shares, and does not edit at
  launch. A meetings plugin (macOS, beta) writes meeting notes as a page.

## 5. Beside Banda

| ChatGPT | Banda now | Note |
| --- | --- | --- |
| Workspace | the Person and their hosts (ADR 0081) | One Person per computer; no organisation |
| Project (chats, files, instructions) | **Project**: a folder, its Threads, `AGENTS.md` (ADR 0026, ADR 0069) | Banda has one place where ChatGPT has two |
| A space (pages) | the same Project's folder, its `.md` files | Documents are files in the Project (documents research) |
| Personal scratchpad | **No Project**, `~/Banda/scratch/` (ADR 0046) | The same idea, already there |
| Chat | **Thread** | |
| Page | a **document**, `.md` or `.fountain` | A file, not a record in a database |
| Library, Images, Files | **Files** (ADR 0073) | With its Trash and undo already |
| Sites | **Tracer App**, Web App, MCP App (ADR 0062) | An Agent builds a small App |
| Visualize block | **Visuals** (ADR 0037) | |
| Sidebar's All, Recents, Favorites | **Items** in the sidebar (ADR 0082, ADR 0087) | |
| Keep Updated, scheduled tasks | **Workflow**; `task@1` reserved (ADR 0085) | |
| Each person's own AI | each Thread's own Harness and Account (ADR 0078) | Documents are plain text, so any Harness edits them |

## 6. What to take

1. **A Thread becomes a document.** "Make a page from this conversation" is
   ChatGPT's most direct bridge between talk and work. In Banda: an action
   on a Thread, "Save as document", where the Agent writes a `.md` into
   the Project from the Thread, and the document links back to it.
2. **References that point without copying.** A block refers to a file, a
   page or a chat. In Banda a document's link to a Thread, a file or an
   Item is its **Address**, written as a plain link in the markdown, and
   the editor draws it as a chip with the Item's title and state. Other
   viewers see a link. This also makes §1 work backwards: a Thread lists
   the documents that refer to it.
3. **The AI's routes, made one model.** ChatGPT has four routes and two
   behaviours: "Ask for change" proposes, `@` mentions write and ask for a
   review after. Banda can keep the routes and one behaviour:
   - The Thread Pane beside the document is route 1, natively, in the
     tiling.
   - A selection sent to a Thread as a chip (ADR 0015) is route 2.
   - Whatever an Agent writes is a write to the file, shown as suggestions
     from Git's checkpoint (documents research §7.3), accepted or declined
     by block. So every route is review after, with the same view.
4. **Runnable blocks.** ChatGPT's Prompt, Task and Agent Instructions
   blocks put the AI's work in the document:
   - A **prompt block** is a fenced block, ` ```prompt `, whose button
     starts a Thread with it. Plain text, readable anywhere.
   - A **task block** is the Kanban card of the documents research: it
     starts a Thread and shows its state.
   - **Agent instructions** are what `AGENTS.md` already is; a document's
     own could sit in its frontmatter.
5. **Never promise automation by prose.** OpenAI had to warn that a
   cadence written in a page schedules nothing. A document that should
   refresh says so in a contract (a Workflow, later `task@1`), and the
   editor shows whether one is set up, never guessing it from the text.
6. **Show where words came from.** ChatGPT warns that memory can leak onto
   a shared page. In Banda an Agent's words in a file carry their author
   through Git and the turn's checkpoint; the editor can show, per block,
   which Thread wrote it, linking to the turn.
7. **Read first on the phone.** ChatGPT's mobile reads, finds and shares
   but does not edit at launch. Banda's phone client (ADR 0089) can start
   the same way for documents.

## 7. What not to take

- **A second place for work.** ChatGPT bolted Space beside Projects and
  left the bridge between them thin. In Banda the Project's folder is both;
  a separate "space" would split it again.
- **Pages kept in a database.** ChatGPT's pages, as described, have no
  export or version history yet. Banda's documents are files: Git keeps the
  history and the export writes files (documents research §5, §7).
- **Inherited sharing between people.** Banda's Person is one computer's
  user, and sharing sends only Problems and counts (ADR 0039). Shares
  between people are not on the road now; if they come, ChatGPT's
  direct-against-inherited view is the part worth copying.
- **Agents that act on their own, not now.** Dots are always on. Banda
  will have an analogue later (Roma, 2026-11-08: "we'll make an analogue of
  dots later"). When it comes, ADR 0083 holds: such an Agent acts as
  itself, never as the Person, whose gesture alone acts as the Person. Its
  edits reach a document as any Agent's do, as suggestions by block (§6,
  3). That it would run unasked and on a schedule is the Workflow's and
  `task@1`'s to carry (§6, 5).

## 8. Open

- Do documents link to a Thread by its Address in plain markdown, and in
  what form (a `banda://` URL, or a relative path the engine resolves)?
- Where do comments live, if documents get them? Not in the Project's
  folder, which holds nothing of Banda's; in the Project's engine data,
  anchored to text, which must survive edits.
- Does "Save as document" write a new file, or append to one the Person
  picks?
