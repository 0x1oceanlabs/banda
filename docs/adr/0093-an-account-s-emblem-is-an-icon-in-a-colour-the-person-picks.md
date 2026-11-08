---
status: proposed
date: 2026-11-08
---

# An account's emblem is an icon in a colour the Person picks

_It replaces ADR 0078's decision 9 (the pill) and amends its decision 10
(the colours). Code is cited from main at `aaae02c1`._

Roma, on 2026-11-07 (translated): "I was thinking how to tell the agents'
subscriptions apart. There are the Claude and ChatGPT logos. Let the Person
just pick the agent's icon: Claude's and Claude Code's, in different
colours, for Claude; Codex's too for ChatGPT, also in colours. Then the
subscriptions are marked, and which account a Person works through shows in
the agent and in the sidebar. In the wider form the name can be added."

On the mockups he chose the icon drawn in its colour (B) over a coloured
tile (A) and a ring (C), asked for Claude Code's own character in place of
a drawn one, and asked that the colours be checked in the light theme and
the dark one, the icons inverting with it.

On 2026-11-08 he settled the words and the rest: the Person-facing word
stays **account**; the icon in its colour is the account's **emblem**, as
"mark" is the Thread's already (`ThreadMark`) and an Unstable mark's;
neutral icons join the Harnesses' own; an account is named after its
Harness until the Person renames it, and its settings show its plan and
email.

**Where it stands.**

- ADR 0078 decision 9 made the mark a pill: a dot in the account's colour
  and the first letter of its name, after the Harness's logo. It is not
  drawn yet: the window shows the Harness's logo alone
  (`client/ui/src/components/harness-logo.tsx`), and its colours are still
  ADR 0055's five (`client/ui/src/styles/globals.css:141-145`, `:194-198`).
- The engine already reads an entry's `mark` (its letters) and `colour`
  (1 to 4) from `harnesses.toml`
  (`platform/harnesses/engine/src/list.rs:53-56`, `:447-453`).
- A pill says the account twice over a logo that says the Harness. With
  two Claude accounts and Codex, a row of the sidebar carries a logo, a
  dot and a letter, where one emblem would do.
- The engine already hears who is signed in: the adapters' `SignedInAs`
  (label, email, organization; `platform/harnesses/engine/src/model.rs:124-141`)
  and the limits' `plan` and `email` (`limits.rs`, ADR 0055).

Evidence: [the check of the colours](../research/2026-11-08-account-icon-colours.md).
The mockups are in Roma's `~/Banda/artifacts/agent-icons/`:
`agent-icons-v1.html` (A, B and C), `agent-icons-v2.html` (B, with the
character), `agent-icons-v3.html` (both themes, the check).

## Decision

1. **An account's emblem is one icon, drawn in the account's colour.**
   - It says both the Harness and the account, so it stands in place of
     the Harness's logo and the pill: the composer's chip, the sidebar's
     rows, the model picker's accounts, the divider of a move, the limit
     card, the limits widget and the Agent Pane's header.
   - Where there is room, the account's name follows it: the sidebar's
     two- and three-line rows, the picker, the divider, the limit card.
   - It is the icon itself in the colour, on no ground, no tile and no
     ring.
   - The word is **emblem**. "Mark" stays the Thread's (`ThreadMark`) and
     the Unstable mark's. ADR 0078's `mark` key keeps its letters
     (decision 2).

2. **Each Harness offers its own icons, and every Harness the neutral
   ones.** An account picks one of its Harness's, or a neutral one:

   | Harness | `icon` | Drawing |
   |---|---|---|
   | Claude Code | `claude-code` | Claude Code's character, from the block characters its CLI prints |
   | Claude Code | `claude` | Claude's spark |
   | Codex | `codex` | Codex's mark: a filled shape with `>_` cut out |
   | Codex | `chatgpt` | OpenAI's knot |
   | any | `key` | a key: an API account |
   | any | `gateway` | two paths joining: a gateway account |
   | any | `box` | a box: an environment sign-in (ADR 0084) |

   - By default an account takes the icon of its kind: a subscription its
     Harness's program's (`claude-code`, `codex`), an API account `key`, a
     gateway `gateway`, an environment sign-in `box`. A gateway's models
     may be another vendor's, so its emblem does not claim a logo.
   - The neutral icons are drawn in the same weight as the Harnesses',
     from Lucide, which the window already uses.
   - A Harness Banda has no icons for offers the neutral ones and its
     letters: the `mark` of the entry, else the first letter of its name,
     in the colour.
   - The character is 18 cells wide and 10 high. At 16 px high it takes
     about 21 px of width, so it weighs as much as the spark; the row
     keeps its line.

3. **Five colours: the Harness's own and four.**
   - The own colour is Claude's orange for Claude Code's accounts, and the
     text's colour for Codex's, so OpenAI's black knot turns white in the
     dark theme. A neutral icon's own colour is the text's.
   - The four are ADR 0078's, with the green moved to teal. Claude's orange
     is darker in the light theme:

     | Colour | Light | Dark |
     |---|---|---|
     | own, Claude Code | `#c96442` | `#d97757` |
     | own, Codex | the text: `#18181b` | the text: `#ededef` |
     | violet | `#8557c8` | `#a072e6` |
     | rose | `#ad3272` | `#c54987` |
     | green | `#189a69` | `#15b77c` |
     | graphite | `#424242` | `#b7b7b7` |

   - With ADR 0078's green, Claude's orange and the green are one colour to
     a deuteranope (ΔE 5.1 light, 4.0 dark), and both sit at 3:1 on the
     light sidebar. With these, every two colours of one Harness are at
     least ΔE 10.1 apart in normal sight and the three colour-blindnesses,
     and every colour is at least 3.4:1 on the sidebar (the research,
     part 3).
   - By default the Harness's own entry takes the own colour, and each
     further account takes the four in turn.

4. **Five icons by five colours make twenty-five emblems per Harness.**
   - Add account offers an icon and a colour no other account of the
     Harness has. The Person may still pick a pair another has; the name
     then tells them apart where it is written.
   - Past that, the Person tells them by name.

5. **In `harnesses.toml`,** an entry's `icon` names its icon, and `colour`
   takes `0` for the own colour beside 1 violet, 2 rose, 3 green and
   4 graphite. `mark` stays: the letters, for a Harness Banda has no icons
   for.

6. **An account is named after its Harness, and shows who is signed in.**
   - A new account's name is its Harness's: `Claude Code`, then
     `Claude Code 2`. The Person renames it in Add account or its ⋯.
     Banda never renames it by itself.
   - Its settings show what the Harness says about it, read-only: the plan
     (`Max 20x`, `Plus`), the email and the organization, the kind, and
     whether the sign-in holds. They come from the adapters' `SignedInAs`
     and the limits' read; Banda reads no file of credentials for them
     (ADR 0043, ADR 0055).
   - The email shows in the settings and the limit card only, never in
     the sidebar or a Thread, where a screen share would show it.

## Consequences

- ADR 0078's decision 9 is replaced and its decision 10 amended, as above.
  Its step 6 (the window) draws this emblem, not the pill.
- `GLOSSARY.md` gains **Emblem** ("an account's icon in its colour"), and
  **Account** names it in place of the pill.
- The engine's entry gains `icon`, and `colour` its `0`; the schema of
  `harnesses.toml` says which icons each Harness has.
- `HarnessLogo` becomes the account's emblem: an icon, a colour and, where
  asked, the name. Its colours replace `--account-1…5` with `--account-own`
  and four.
- The drawings are their owners' marks. Claude's and OpenAI's come from
  T3 Code (MIT), as now; Codex's from LobeHub's icons (MIT,
  `src/Codex/components/Mono.tsx`); Claude Code's character is drawn from
  its CLI's block characters. Each file says where it comes from.
- Claude's orange in the light theme, `#c96442`, is darker than the logo's
  `#d97757`, for contrast on a light ground.

## Steps

Each step is its own PR.

1. This ADR and the research.
2. The engine: `icon`, `colour = 0`, the defaults and the schema.
3. The window: the emblem in every place decision 1 names, and the colours.
4. Add account and an account's ⋯: the name, the icon and colour pickers
   with the free pair offered first, and what the Harness says of the
   account.
