---
status: accepted
date: 2026-11-08
---

# An account has an emblem the Person picks, and a new Thread has a fallback account

_It replaces ADR 0078's decisions 8 (a new Thread's account) and 9 (the
pill), and amends its decisions 6 (the limit card) and 10 (the colours).
Code is cited from main at `aaae02c1`, T3 Code at `337c5858`._

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
neutral icons join the Harnesses' own, picked from how people use several
accounts; an account is named after its Harness until the Person renames
it, and its settings show its plan and email. Then, on the settings
mockups: "like T3 Code, a default and a fallback, so that when the limits
run out it goes to another"; a running Thread is not moved, only offered
the fallback with a button; the fallback may be another Harness's
account.

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
- ADR 0078 decision 8 starts a new Thread on its Harness's default account
  even when that account is spent, with a warning. T3 Code has a default
  model and a fallback model: "Used for new threads when the default
  model's provider is out of usage"
  (`apps/web/src/components/settings/ProjectDefaultsSettings.tsx:259`). It
  applies to a new thread only, and only when the fallback is signed in and
  not spent itself (`packages/shared/src/usageLimits.ts:65-102`).

Evidence: [the check of the colours](../research/2026-11-08-account-icon-colours.md).
The mockups are in Roma's `~/Banda/artifacts/agent-icons/`:
`agent-icons-v1.html` (A, B and C), `agent-icons-v2.html` (B, with the
character), `agent-icons-v3.html` (both themes, the check),
`accounts-settings-v1.html` and `accounts-settings-v2.html` (Settings →
Agents; v2 is the one this ADR follows).

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
   ones.** An account picks one:

   | Group | `icon` | Drawing | For |
   |---|---|---|---|
   | Claude Code | `claude-code` | Claude Code's character, from the block characters its CLI prints | |
   | Claude Code | `claude` | Claude's spark | |
   | Codex | `codex` | Codex's mark: a filled shape with `>_` cut out | |
   | Codex | `chatgpt` | OpenAI's knot | |
   | Whose | `work` | a briefcase | the work account |
   | Whose | `personal` | a house | one's own |
   | Whose | `team` | people | a team's plan |
   | Whose | `client` | a building | a client's or an employer's |
   | What for | `spare` | a life buoy | kept for when the others are out |
   | What for | `experiments` | a flask | trying models and settings |
   | How it runs | `key` | a key | an API key, billed by use |
   | How it runs | `gateway` | two paths joining | OpenRouter, LiteLLM |
   | How it runs | `cloud` | a cloud | Bedrock, Vertex |
   | How it runs | `local` | a chip | Ollama, LM Studio |
   | How it runs | `box` | a box | an environment sign-in (ADR 0084) |

   - The neutral icons follow why people keep several accounts: Claude
     Code's own recipe is a folder per account, "work" and "personal"; Codex
     points to an API key for when the subscription runs out, and knows
     Ollama, LM Studio, Bedrock and Vertex as providers
     ([the research of 2026-11-06](../research/2026-11-06-accounts-and-switching.md),
     part 3, Claude Code and Codex CLI).
   - By default an account takes the icon of its kind: a subscription its
     Harness's program's (`claude-code`, `codex`), an API key `key`, a
     gateway `gateway`, a local model `local`, an environment sign-in
     `box`. A gateway's models may be another vendor's, so its emblem does
     not claim a logo.
   - The neutral icons are Lucide's (`briefcase`, `house`, `users`,
     `building-2`, `life-buoy`, `flask-conical`, `key-round`, `merge`,
     `cloud`, `cpu`, `box`), which the window already uses, in the same
     weight as the Harnesses'.
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

4. **Fifteen icons by five colours.**
   - Add account offers an icon and a colour no other account of the
     Harness has. The Person may still pick a pair another has; the name
     then tells them apart where it is written.

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
   - Its settings also show what Banda knows of it: the Threads on it now,
     when it was last used, and its Turns this week. Each Turn records its
     account (ADR 0078 decision 2), so the engine counts them.

7. **A new Thread starts on the default account, or on the fallback while
   the default is out** (_decided_). This replaces ADR 0078 decision 8.
   - Settings → Agents begins with **New Threads**: the default, an account
     and a model, and the fallback, an account, of any Harness.
   - A new Thread the Person did not put on an account themselves starts
     on the fallback while the default is out: a limit
     window spent, or its sign-in gone. It starts there only when the
     fallback is signed in and not spent itself; else on the default, with
     ADR 0078's warning. Once the default resets, new Threads start there
     again.
   - The section says what happens now: "Work is out until 14:20: new
     Threads start on Personal until then."
   - The fallback may be another Harness's account. A new Thread has
     nothing to hand over, so no confirmation is asked.

8. **A running Thread is offered the fallback, never moved to it**
   (_decided_). ADR 0078 decision 7 stands.
   - The limit card (ADR 0078 decision 6) puts the fallback first, as its
     main button, when one is set and has room; else the account of the
     same Harness with the most room, as before.
   - A fallback of another Harness goes through ADR 0078 decision 5's
     handoff and its confirmation.

9. **Settings → Agents shows the accounts as cards, and adds one in three
   steps.**
   - A card per account, by Harness: the emblem, the name, Default or
     Fallback, the plan and email, its two widest limits, and its Threads
     and last use. A spent or signed-out account is dimmed, with its action
     on the card ("Sign in again"). Each Harness ends with an "Add" card.
   - An account's page: the emblem large on its colour, the name edited in
     place, "Make default" and "Use as fallback", what the Harness says
     (decision 6), the limits, what Banda knows, the emblem's picker by its
     groups, and the folder, models and adapter.
   - Add account: **what** (a Claude or ChatGPT subscription, an API key, a
     gateway, a local model, or a folder already signed in on this
     computer), then **name and emblem**, where "What is it for?" names it
     and picks its icon in one click (Work, Personal, Team, Client, Spare,
     Experiments), then **sign in**.
   - **Remove** takes the account out of Banda and does not sign it out.
     Banda deletes its folder only if Banda made it. Its Threads move to the
     default once their Turn ends; the confirmation says how many. That is
     the Person's click, so ADR 0078 decision 7 holds.

## Consequences

- ADR 0078's decisions 8 and 9 are replaced, and its decisions 6 and 10
  amended, as above. Its step 6 (the window) draws this emblem, not the
  pill.
- `agents.toml`'s `[start]` gains `account` and `fallback`, by the
  entries' IDs, beside its `options`' model.
- `GLOSSARY.md` gains **Emblem** ("an account's icon in its colour"), and
  **Account** names it in place of the pill.
- The engine's entry gains `icon`, and `colour` its `0`; the schema of
  `harnesses.toml` says which icons each Harness has, and the neutral ones.
- The engine counts, per account, its Threads now, its last Turn and its
  Turns this week.
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
4. New Threads: `account` and `fallback` in `[start]`, the choice of a new
   Thread's account, and the limit card's first button.
5. Settings → Agents: the cards, an account's page and Add account, with
   the per-account counts.
