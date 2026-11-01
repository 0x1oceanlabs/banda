# T3 Code's thread window, and what our Thread Pane lacks

- **Date:** 2026-11-01.
- **Sources:**
  - **T**: github.com/pingdotgg/t3code at `1d626d02` (2026-11-01), MIT, a
    fresh shallow clone. This is T3 Code's web `0.1.6` with "orchestration
    V2": runs, attempts and projected turn items. It has grown a lot since
    the `15fe2832` clone of the earlier notes: `ChatView.tsx` alone is 4,010
    lines.
  - **S**: npm `streamdown` 2.7.1 and `@streamdown/code` 2.0.0, and the
    Streamdown docs through Context7.
  - **B**: Bandaso at `39d4925`, `modules/agents/pane/src`.
- **How:** we read code and docs and ran nothing.
- **Limits:** evidence, not a decision. Line numbers drift. We did not run
  T3 Code from this clone; what it feels like comes from Roma using T3 Code
  every day.

Paths under T are relative to `apps/web/src/` unless they start with
`packages/`.

## The window

Top to bottom (`components/ChatView.tsx` 3294–3994):

- A header: the project, the title (double-click renames), the panels'
  buttons.
- The timeline, with a floating "Scroll to end" pill.
- The composer, laid over the timeline's bottom; the timeline keeps an end
  inset as tall as the composer.
- A terminal drawer under the chat, and a tabbed, resizable right panel:
  browser, terminal, diff, files, pull requests, side chat
  (`rightPanelStore.ts:38-79`).

A new thread is a "draft hero": the composer sits in the middle under
"What should we build in {project}", and docks at the bottom on the first
send with a view transition (`draftHeroTransition.ts`).

## The timeline

Two pure stages turn items into rows:

1. `session-logic.ts` `deriveTimelineEntriesFromVisibleTurnItems` (567):
   items become entries: `message`, `proposed-plan`, `work` (any tool, with
   a label such as "Ran command" or "Changed 3 files", a tone and a
   status), `event`.
2. `components/chat/MessagesTimeline.logic.ts` `deriveMessagesTimelineRows`
   (1393): entries become rows: `message`, `work`, `work-toggle`,
   `work-live`, `working`, `thinking`, `turn-fold`, `proposed-plan` and a few
   others. Stable identities keep rows that did not change from rendering
   again (`computeStableMessagesTimelineRows`, 2367).

**Work groups** (1798–1940). Consecutive tool entries of one run merge into
one group; an error, a notice, an answered question or a pending approval
ends it. A group of more than one is one line that names its two largest
kinds: "Ran 3 commands and edited 2 files", "Performed 4 other actions"
(`packages/client-runtime/src/work-log/presentation.ts:517`
`summarizeToolGroup`). Opened, it lists its entries in a box no taller than
`min(18rem, 50dvh)` with fades at its edges; each entry opens on its own:
the command and its output, or the files with `+N −M` and "Open diff".

**While a turn runs.**
- A "Working for 12s" row with a ticking timer starts the reply
  (`TimelineWorkGroupRows.tsx:278-310`).
- The tail of tool entries collapses into one `work-live` row showing only
  the latest running tool, with a moving shine on its label; the latest
  thought shows above it as a four-line preview (1505–1577).
- With no tool running, a "Thinking" row with a shimmer (2104–2139).

**A turn that ended** (`deriveTurnFolds`, 1001–1218). Its work folds into one
row, "Worked for 1m 05s" ("You stopped after 8s" when stopped), with a
chevron. The final reply stays in view. A failed turn does not fold.
Under the reply, a card lists the files the turn changed with their
`+N −M`; a file opens the turn's diff (`TimelineAssistantRows.tsx:297-380`).
In T3 the card comes from git checkpoints, so it is empty outside git.

**Messages.**
- The Person's message is a right-aligned bubble, `rounded-2xl`, at most 80%
  wide. Over 8 lines or 600 characters it is clamped, with a fade and "Show
  full message" (`TimelineUserMessageRow.tsx:1095`).
- The Agent's reply is plain prose, no bubble, in markdown.
- Hover shows a copy button and the time; touch shows them always
  (`TimelineRowParts.tsx:13`).

**Markdown.** A custom unified pipeline (`components/chat/markdownRenderer.ts`)
with GFM, math, Mermaid, alerts. While streaming, text is cut at closed
blocks so finished blocks keep their render (`markdownStreamBlocks.ts`).
Code blocks use Shiki, with Copy and a wrap toggle
(`components/chat/MarkdownCodeBlock.tsx`). The streaming text re-renders only
its own row (`useAssistantMessageText`).

## Scrolling

- `@legendapp/list` virtualizes the timeline
  (`components/chat/MessagesTimeline.tsx:1320-1365`).
- `useTimelineFollow.ts` follows the end until the Person scrolls up with
  the wheel, touch or keys; the code's own scrolls are marked so they do not
  count.
- A sent message is anchored near the top (24px) and the reply grows below
  it; the anchor lets go when tools start (`ChatView.logic.ts:271`).
- The pill says what is hidden below: "Scroll to end · 2 queued · waiting
  for input" (`TimelineOverlays.tsx:27`). It shows after 150 ms and hides at
  once.
- Each thread keeps its scroll place; the last 16 timelines stay in memory,
  so switching does not flash.

## The composer

`components/chat/ChatComposer.tsx`, 3,544 lines, on tiptap.

- `/` commands, `@` files, `$` skills, `#` pull requests
  (`composer-logic.ts:251`).
- Paste, drop and a button attach files; a long pasted text becomes a file.
- The footer: model picker, reasoning effort, the permission mode
  (Supervised, Auto-accept edits, Auto, Full access), Build/Plan, a context
  meter. Unfocused, the controls fade to "resting".
- **The primary button** (`ComposerPrimaryActions.tsx`): an arrow; a red
  square to stop while a turn runs and the box is empty; with text while a
  turn runs, "Queue" (list-plus) or "Steer" (corner-up-right). A setting
  picks the default; Mod+Enter or Mod+click picks the other.
- **The queue** (`QueuedRunsControl.tsx:445`): dashed, unfilled bubbles at the
  timeline's end, each with Send now, Edit and Remove. Alt+↑ brings the last
  one into the composer to edit ("Editing in the composer · Cancel").
- ↑/↓ walk earlier prompts; Shift+Tab toggles plan; Esc closes a menu;
  typing anywhere focuses the composer.
- Drafts persist per thread in localStorage, written after 300 ms
  (`composerDraftStore.ts:112-120`).

## The Agent asks

**Approvals** are rows in the timeline, in place of the live work row
(`TimelinePendingApprovalRow.tsx`): the kind's icon, the command or file in a
code box, the reason, then "Decline · Approve · More ▾", with "Always allow
this session" under More. While one waits, the composer says "Send a message
to decline and redirect the agent".

**Questions** sit in a drawer on top of the composer
(`ComposerPendingUserInputPanel.tsx`): one question at a time, its options as
single or multi choice, keys 1–9 pick, a single pick moves on after 200 ms,
the composer takes a free answer, "Previous / Next / Submit". Answered, the
question stays in the log as a work row.

## Plan mode

- Shift+Tab, `/plan` or the toggle.
- A proposed plan is a card with a "Plan" badge, its title, Copy and
  Download; long ones collapse (`ProposedPlanCard.tsx`).
- When the turn has ended with a plan, a "Plan ready · {title}" banner sits
  on the composer, the placeholder says "Add feedback to refine the plan, or
  leave this blank to implement it", and the button is **Implement** (with
  "Implement in a new thread" under ▾), or **Refine** once text is typed
  (`ComposerPrimaryActions.tsx:204-260`).
- Implement sends `PLEASE IMPLEMENT THIS PLAN:` and the plan in the default
  mode; Refine sends the feedback in plan mode (`proposedPlan.ts:54-76`).
- A to-do list is a quiet "Tasks 3/7 · current step" row.

## Small touches

- Edit from here: a pencil on a message rewinds the conversation to it, and
  the prompt returns to the composer (`useTimelineRewind.ts`).
- Fork from a reply, a minimap of the Person's messages, find in thread
  (Mod+F) that opens folded rows, citing selected text into the composer.
- Shimmer and shine on live labels (`index.css:551-610`), morphing chevron
  and copy icons, fade-ins.

## Git-bound parts

The branch toolbar, worktree setup, "revert files too", pull requests, the
changed-files card and turn diffs all come from git. The rest is about the
conversation and fits any Harness.

## Streamdown

- `streamdown` 2.7.1: React 18 or 19, unified with GFM, sanitized HTML,
  `remend` to close unfinished markdown while it streams, `isAnimating` to
  hold the copy buttons while text still arrives, a `controls` prop for
  code, table and Mermaid buttons.
- `@streamdown/code` 2.0.0: Shiki highlighting as a plugin,
  `createCodePlugin({ themes: [light, dark] })`.
- Tailwind 4 needs `@source` on Streamdown's `dist/*.js`.
- It is what shadcn's AI Elements uses for a reply.

## Our Thread Pane, against this

B already has: messages, thoughts, tool calls with diffs and output, plans,
Questions with forms, notices, failed turns with Try again and sign-in, the
queue with Send now, Edit, Remove, steering, `/` commands, images, plan mode
and the settings bar (`ThreadPane.tsx`, `thread.ts` `rows`).

It lacks, against T:

1. Markdown and highlighted code; the reply sits in a bubble.
2. Work groups, the live row, "Working for", turn folds. `TurnView` has no
   start or end time; items have `at`.
3. A turn's changed files, and a diff of its own.
4. Approvals as T3 shows them; Questions in a drawer with keys.
5. A plan card with Implement and Refine.
6. The primary button's Queue and Steer, Alt+↑, prompt history, drafts.
7. The anchor on a sent message, the pill that says what waits below,
   the scroll place per Thread.
8. Find, the minimap, edit from here, fork, `@` files.
