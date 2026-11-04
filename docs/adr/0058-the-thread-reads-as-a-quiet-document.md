---
status: accepted
date: 2026-11-04
---

# The Thread reads as a quiet document

Roma likes how Banda's chat works and asked to go through every element
and bring it under one style: "хороший красивый элегантный чат, в котором
приятно работать, и чувствуется эстетика и что над ним поработали",
taking the best from Claude, Codex, Cowork and Work. The evidence is
[the chat's look](../research/2026-11-04-chat-look.md): Banda's Thread
Pane rendered and measured, and the five others from real captures.

In short, the Thread Pane does what ADR 0010 asked, but its parts don't
share values: six radii, eight type sizes with reply headings at 24px,
three ways to draw a block, and what waits for the Person drawn as the
faintest row. The others agree on a skeleton Banda mostly has already;
where they are better is in how little they draw.

**Decision.** Roma decided the points marked _decided_ on 2026-11-04
("делаем всё", "да, переносим"). The rest are our defaults and stay his to
change.

1. **One concept: a quiet document** (_decided_). The Agent's reply reads
   as well-set text; its work folds into grey lines; colour marks only
   meaning. Every element of the Thread Pane takes its values from one
   set, kept in `@banda/ui`'s `globals.css` beside the look's tokens:
   - **Type:** prose (the reply and the Person's message), ui 14/20 (work
     lines, cards, menus), meta 12/16 (times, counts, captions, small
     buttons), mono 12.5/20 (code, diffs, consoles, paths). Headings in a
     reply are at most 18px and weight 600; card titles are 14, weight 550.
   - **Radii:** 6 for chips and inline code, 8 for buttons and rows, 12
     for a block, 16 for the Person's bubble, the composer and what docks
     on it, full for round controls.
   - **Surfaces:** the ground; a *block*, the ink at 3.5% over the ground;
     a *raised* fill at 7% (the bubble, chips, insets); lines in
     `--border`. They are mixed from `--background` and `--foreground`, so
     every theme gets them.
   - **Colour means one thing each:** `--attention` is what waits for the
     Person; `--destructive` marks a failure as a tag or an icon, not a
     whole row; `--added` and `--removed` are line counts. Effort and the
     Fast switch no longer borrow the terminal's palette.
   - **Rhythm:** a 4px grid; 20 between rows of the Thread, 8 to 12
     inside them. Hover actions take no room until shown.
   - **Icons:** lucide, 15px in rows and 14 in small buttons, one stroke.

2. **Text follows the Pane, not the window** (_decided_: Roma tiles, two
   Agents and sometimes the sidebar on one screen). The Thread Pane is a
   CSS container. Under 40rem its prose is 14/22 with 16px sides; from
   40rem, 15/24 with 24px sides. The prompt follows the same width.

3. **One block.** A code block, a table, a Mermaid diagram, a card, a
   console and a diff are all one shape: the block surface, a 1px line,
   radius 12. A label sits in its top-left corner and its actions in the
   top-right, faded until hovered. No frame inside a frame.

4. **Work reads as one line.** A turn's folded work says how long, what it
   did, what failed and how much changed: "Worked for 1m 05s · ran 3
   commands (1 failed), edited 2 files +38 −9". Opened, it is one list
   under one rule, each call in the past tense with a "Failed" tag where
   it failed; a call's output opens under it and does not scroll inside
   another scroll. A turn the Person stopped says so once.

5. **The live line is at the live edge.** While a turn runs, "Working for
   45s" sits at the end of the turn, after what it has done, with what it
   does now: "· Running pnpm test · 11s", or "· Waiting for you".

6. **Decisions dock on the composer** (_decided_). This replaces ADR 0010,
   decision 5, first point.
   - Every Question that waits for the Person, choices or form, shows in
     the drawer on the composer, where they already look. The Thread keeps
     a line in its place, "Waiting for you: …", in `--attention`.
   - A permission says in words what it allows and shows the command in
     mono. Its answers carry their keys: the decline answer `Esc`, the
     main answer `⏎`, choices `1`–`9`. "Allow once" stays the main answer;
     "always" answers stay under More.
   - Answered, a Question folds to one line in the Thread: "Allowed:
     pnpm test", as an answered Issue does.

7. **A turn's changes are a card with a verb.** "Edited 2 files +38 −9",
   the folder dimmed and the file's name bright, and **Review**, which
   opens the Diff Pane (ADR 0010, decision 3). Undo waits for a way to
   take a turn's edits back.

8. **The composer is the same shape as what docks on it.** Radius 16, all
   its controls 28px; model and effort as text, the effort lighter; while
   a turn runs it says "Steer this thread…" and keeps queueing and
   steering as ADR 0010 says. A queued message is the Person's bubble,
   dashed, with quiet actions.

9. **Later, each its own decision.** A plan to comment on by selecting its
   text (Claude Code), a Progress and Outputs panel (Cowork, Work),
   Threads grouped by what waits ("Needs you", "Ready"), Undo of a turn's
   edits, a reply font of the Person's choosing.

**Build order.** One PR each: (1) the values, the reply's type and the one
block, with the Mermaid card; (2) work lines, the live line and the
Thread's rhythm; (3) cards and decisions on the composer; (4) the
composer, the queue and the menus.

**Consequences.**

- ADR 0010 stands except its decision 5, first point: a Question with
  choices no longer sits in the timeline as a card.
- `@banda/ui` gains the chat's values and a Mermaid look of its own
  (`lib/diagram-look.ts`); Streamdown's blocks are restyled, not replaced.
- Tests that look for a Question's buttons in the timeline look in the
  drawer.
