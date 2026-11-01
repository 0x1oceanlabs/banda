---
status: accepted
date: 2026-11-01
---

# The composer is a prompt editor, as in T3 Code

ADR 0010 made the Thread Pane read as T3 Code's. Its composer kept a
plain textarea: `@` puts a file's path in as text, `/` works only as a
whole message, and the box knows nothing of markdown. On 2026-11-01 Roma
asked for "a proper input as in T3 Code" (толковый инпут как в t3 code).

T3 Code's composer is an editor on tiptap, ProseMirror under it
(`apps/web/src/components/ComposerPromptEditorTiptap.tsx`, about 1,900
lines, tiptap 3.31). What it does that a textarea cannot:

- Files, skills, quoted text and other context sit in the text as
  **chips**: an icon and a short name, the full path on hover. A chip is
  one thing: the caret steps over it, Backspace takes it whole. A textarea
  with an overlay cannot do this, as a chip is narrower than the text it
  stands for.
- The text is **markdown as it is typed**: bold, italic, strikethrough,
  inline code, quotes, headings, rules, lists and task lists, and code
  blocks with a language picker and highlighting.
- The editor is a view over a **string**: the draft is markdown text, each
  chip writes its own source into it, and what is sent is that string.

**Decision.** Roma decided the points marked _decided_ on 2026-11-01; the
rest are our defaults and stay his to change.

1. **A prompt editor on tiptap** (_decided_). `@banda/ui` gains one
   component, `prompt-editor`, on `@tiptap/core`, `@tiptap/react` and
   `@tiptap/pm`, so other modules' Panes can use it. Its value is a
   string in and a string out, so drafts, history, the queue and `send`
   stay as they are; only the field changes.

2. **Chips** for what a message points at.
   - `@` and a word anywhere in the text asks for files, as now; the file
     picked is a chip with its kind's icon and its name. It is written to
     the message as `@path`, which Claude Code and Codex read as a file.
   - `/` opens the commands at the start of a line, not only as the whole
     message. A command that acts at once (plan mode on or off) does so.
   - The caret steps over a chip, Backspace takes it whole, and a chip in
     pasted text is a chip again.

3. **Markdown as it is typed, as in T3 Code** (_decided_): bold, italic,
   strikethrough, inline code, quotes, headings, rules, bullet, numbered
   and task lists, and code blocks. ``` and Enter starts a code block;
   Tab indents in it; its language is picked from a list, and Shiki
   highlights it in the theme's light and dark, as `@streamdown/code`
   already does for replies. Lists go on with Enter. Typed with text
   selected, `(`, `"`, `` ` `` and `*` wrap it.
   - The string is read and written by our own code, line by line, as
     T3 Code does, not by a markdown library: `@tiptap/markdown`
     escapes plain text (`snake_case` comes back `snake\_case`) and
     folds lines together. Each style keeps the delimiter it was typed
     with (`**` or `__`, `*` or `_`) and which style was outside, so
     any string comes back character for character; a delimiter that
     pairs with nothing stays text.
   - A line is one block, as it starts: `# ` a heading, `> ` a line of a
     quote, `- `, `1. ` or `- [ ] ` an item, `---` a rule. A list is not
     nested in the document: each item is as far in as the spaces before
     its marker, which it keeps, as it keeps its marker and its number.
     Shift+Enter goes on with a list or a quote, an empty item ends it,
     Tab and Shift+Tab move an item in and out, and Backspace at a line's
     start makes it text. Lines inside a ``` fence stay text until code
     blocks come.
   - Pasted text is read as a prompt is, even text copied from the box,
     so how its lines and styles were written is kept.

4. **The box behaves.**
   - A key typed, or text pasted, anywhere in the Thread Pane outside a
     field goes into the composer.
   - A message longer than 120,000 characters says so under the box and
     is not sent.
   - The placeholder says what the box does now: write, answer, refine
     the plan, say no.
   - Enter never sends while an IME composes.
   - The draft is written 300 ms after typing stops, and before the
     window closes.

5. **Paste and drop.** A pasted text of 32 KiB or more becomes a text
   file attached to the message, not text in the box; Mod+Shift+V pastes
   it as text. A file dropped on the Thread is attached, as images are
   now. A draft keeps its images.

6. **Later, each when it is built.** `$` and a skill's name, as a chip,
   once a Harness says which skills it has; quoting a reply's selected
   text into the composer as a chip; undoing a chip's removal with what
   it carried.

**Build order.** One PR each: (1) the prompt editor in place of the
textarea, nothing else changing, (2) chips for `@` files and `/` anywhere
at a line's start, (3) markdown, in parts: (3a) bold, italic, strike
and inline code, (3b) quotes, headings, rules and lists, going on
with Shift+Enter, (3c) code blocks with their language and Shiki, (3d)
wrapping a selection, (4) the box behaves,
(5) paste and drop, (6) skills and quotes, once their ADR 0010 parts are
checked with the Harnesses.

**Consequences.**

- `@banda/ui` depends on tiptap 3 and ProseMirror; the window loads them
  once, for every Pane that has a composer.
- The composer's tests drive a contenteditable, not a textarea: e2e
  tests type and read the editor's text instead of `fill` and
  `toHaveValue`.
- Messages a Person sends may carry markdown; the Agents read markdown,
  and the Thread shows a Person's message as it was typed.
