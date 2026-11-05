---
status: accepted
date: 2026-11-06
---

# The Person names a Thread, and its Harness's small model suggests the name

A Thread's title is its first message, cut to 60 characters
(`rules::message::title`), and nothing changes it. Nobody can rename a
Thread: not the Person, not the window, not the engine. The row's menu in
the sidebar has one item, Archive. A double click on a Pane's header makes
its column full width (ADR 0066, decision 4).

Roma runs long sessions with one Agent. They start on one task and move
on to the next one beside it, so the title stops saying what the Thread
does. He renames it so that, when the Agent finishes, he sees which work
it finished. A title is useful when it says the gist in a few words. A
long one does not help.

We made mockups with Roma on 2026-11-05 and 11-06
(`thread-rename-v1.html` to `v3.html`, in his
`~/Banda/artifacts/thread-rename/`). Each shows the current window beside
the proposal. His answers:

- v1: "клик открываеться меню двайной клик переименовать"; F2 yes; a
  title suggested by a model, yes.
- v2: the menu opens at once, and the first click on a Pane that is not
  focused only focuses it. A cheap model of the same Harness, in the
  language of his messages.
- v3: "давай не усложнять без авто тайтлов а то это будет путать".
  Nothing renames a Thread by itself. "мне понравилось твое предложение
  про преложения тайтла … я нажал и название обновилось само": one press
  of Suggest renames the Thread. "главное суть".

## Decision

Roma decided the points marked _decided_. The rest are our defaults and
stay his to change.

1. **The Person renames a Thread in place** (_decided_).
   - **Where**: a double click on the title in the Pane's header; `F2` on
     the focused Thread (the action `thread.rename`); "Rename…" in the
     Thread menu (decision 5). From the sidebar's menu, the field opens
     in the row.
   - **The field** stands where the title was, with all its text
     selected. Enter, or a click elsewhere, keeps it. Esc leaves the old
     title. The title is one line of up to 120 characters, its spaces
     trimmed. An empty field gives back the first message's title.
   - A double click on the rest of the header still makes the column
     full width, as ADR 0066, decision 4, says.

2. **Nothing renames a Thread by itself** (_decided_). The first
   message's title holds until the Person renames the Thread. The engine
   does not rename it as the work moves on, and neither does the Agent.
   A title that changes by itself would leave the Person unsure which
   Thread is which.

3. **Suggest a title, in one press** (_decided_).
   - **Where**: "Suggest a title" in the Thread menu, and `Shift+F2` on
     the focused Thread (the action `thread.suggest-title`). Both rename
     at once. While the model writes, the title shimmers "Thinking of a
     title…". Then a toast says "Renamed to ‹title›", with Undo (ADR
     0048). If the title already says it, the title stays and the toast
     says so.
   - **In the field**: a ✨ button at its end puts the suggestion in the
     field, selected. Enter keeps it, typing changes it, Esc leaves the
     old title.
   - **What it says**: what the Thread does now, not what it started
     with. Two to four words, at most 30 characters, in the language of
     the Person's latest messages. It keeps what the Person finds things
     by, such as `#586`, `ADR 0069` or `motion.spec`. It leaves out the
     Project's name, which the row shows already, and words like
     "Discussion of", quotes and a full stop.

4. **The engine names, and the Harness's small model suggests.**
   - `agents.rename {thread, title?}`, a `Write` command. Without a
     title, or with a blank one, the first message's title comes back. It
     writes the fact `thread.renamed {thread, title, was}`, and
     `ThreadSummary` keeps `was`, the title before. So every window and
     every machine shows the same title, and "Previous title" can bring
     the last one back.
   - `agents.suggest_title {thread} -> String`, a `Write` command, as it
     runs a model. It is a short run apart from the Thread, as
     `agents.write` is (ADR 0034, decision 3): nobody sees it, the
     Harness may change nothing, and the Thread's own session is not
     touched. It does not rename the Thread. The window renames it with
     what comes back.
   - **The model** (_decided_): the Thread's Harness's small model.
     That is, among the models the Harness offers, the first whose name
     says `haiku`, `mini`, `flash`, `lite` or `small`. With none, it is
     the Thread's model at the least effort it offers, as `agents.write`
     runs.
   - **The folder**: an empty one of the engine's, not the Project's. The
     prompt holds all the run needs, and a Harness reads less there:
     Claude Code reads no `CLAUDE.md` of the Project.
   - **The prompt** holds the Person's last six messages, the last
     600 characters of the Agent's last reply, the Plan if there is one,
     and the title now, with the rules of decision 3. The latest
     messages come first, and the start of the Thread is left out.
   - The engine takes the reply's first line, drops quotes, a full stop
     and a leading "Title:", and cuts it at a word to 30 characters. An
     empty reply is refused, with the Harness's words.

5. **One Thread menu, at the title and at the row** (_decided_).
   - **Where**: a click on the title in the header, on a focused Pane;
     the first click on a Pane that is not focused only focuses it. A
     right click on the Thread's row in the sidebar. Over the title, the
     pointer shows a quiet fill and a ▾.
   - **What it holds**, in this order:
     - Rename… `F2`
     - Suggest a title `Shift+F2`
     - Previous title, when there is one
     - Mark as unread, or Mark as read `Alt+Shift+U`
     - Make a Project from it…, for a Thread in No Project (ADR 0046)
     - Archive thread, or Unarchive thread `Alt+S`
   - Snoozing (ADR 0074, decision 5) adds "Snooze…" `Alt+Z` here, in its
     own step.
   - The Pane menu (ADR 0066) stays as it is: a right click on the
     header and the ⊞ button open it.
   - **How the window asks**: the menu lives in the window, and the
     Thread is the agents module's. A module's window part says how to
     rename, suggest a title for and mark as unread a thing it lists
     (`Module.listed`). The window finds the module by the first word of
     the thing's Pane kind (ADR 0022, decision 5).

6. **Mark as unread** (_decided_).
   - It takes back the Person's "seen" of the Thread's last finished
     turn, one of the marks the window keeps (ADR 0005, decision 8). The
     Thread is "done" again in the sidebar and in its header, and it
     calls again where marks call (ADR 0011).
   - It holds while the Thread has the focus. Leaving the Thread and
     coming back reads it, as Gmail does.
   - Only a Thread with a finished turn has it. "Mark as read" marks that
     turn seen.
   - `Alt+U` already goes to the Thread that calls (`calls.answer`), so
     this is `Alt+Shift+U`, the action `thread.unread`. It works both
     ways.

## Consequences

- A Thread's title is the Person's. It changes only when the Person
  renames it, by hand or with one press of Suggest.
- Each Suggest is one short run on the small model, a sliver of the
  Person's usage. Nothing runs unless the Person asks.
- `F2`, `Shift+F2` and `Alt+Shift+U` are taken. None was bound before.
- A Harness without a small model suggests with the Thread's own model,
  more slowly.
- Seen and archived stay the window's for now. The title is the
  engine's, as the snooze is (ADR 0074).

## Steps

1. **This ADR.**
2. **The engine**: `agents.rename`, `agents.suggest_title`, the fact,
   `was`, the small model and the empty folder (decision 4).
3. **The window**: the Thread menu at the title and the row, the field,
   Suggest and its toast, Mark as unread, the three keys, and
   `Module.listed` (decisions 1, 3, 5 and 6).
