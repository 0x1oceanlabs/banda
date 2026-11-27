---
status: accepted
date: 2026-11-27
---

# A Harness is set up in steps the engine runs, in one sheet

_It replaces ADR 0059's decisions 5 and 6, amends its decision 4 and its
steps 3 to 5, and keeps the rest. It serves
[what we build](../what-we-build.md)'s principle 7, Banda is an adapter,
not a Harness, whose check is that a new Agent joins with no special
code, and the rule that text is the interface._

Roma, on 2026-11-27 (translated): "My user downloads Banda and is no
developer. Claude is there, the Claude CLI is not, nor a dev
environment. Banda needs something like a setup wizard that helps the
Person install all that work needs. It is the real bottleneck." Then, of
the mock (`~/Banda/artifacts/first-run-setup/mock.html`): variant A, the
row and a sheet of steps, "simple and elegant"; for Linux, macOS and
Windows at once; the Person picks Claude Code or Codex; "other Agents
come later, so make it universal".

## Where it stands

ADR 0059 gave the Person the adapters and left the CLIs to them. Its
step 1 is built; its row, its card and its Install (steps 3 to 5) are
not. So a Person with no CLI meets a sentence, "which is not installed on
this computer: install it, then check again", and nothing to press. What
the engine has already:

- It runs a sign-in to its end and a window only watches it (ADR 0108,
  decision 5).
- It finds a CLI in its vendor's folder as well as on PATH, on Windows
  too, so a fresh install is found with no restart (`cli.rs`).
- What differs between Harnesses is one table (`kinds.rs`; ADR 0108,
  decision 6).

Two things ADR 0059 decided do not fit a Person who is no developer: "no
wizard" (decision 5), and the installer in a terminal Pane beside the
card (decision 6). A terminal is the part such a Person cannot read.

## Decision

1. **A Harness says how it is set up, as steps.** A step has an ID, a
   name, one line of what it is for in plain words, how the engine tells
   it is done, and what the engine runs to do it on each system. The
   steps of a Harness Banda knows are in its row of `kinds.rs`. Claude
   Code and Codex have two, the same on Linux, macOS and Windows:
   - **install**: its CLI is found and says its version;
   - **sign in**: it says someone is signed in.

   A third Harness is a third row. An entry of the Person's own in
   `harnesses.toml` has no steps until its Harness says them; it has a
   row with no Set up.

2. **The engine runs a setup to its end.** In `harnesses`:
   - `setup {harness}` reads the steps and the state of each: done,
     waiting, running, asks, failed, with what it said;
   - `setup_start {harness}` runs what is not done, in order, and stops
     at the first that fails;
   - `setup_watch` is that state as it changes, ending when it is done;
   - `setup_cancel` stops it.

   One setup per Harness at a time. It goes on with no window watching.
   `banda harness setup <id>` is the same calls: one process, stdout its
   steps, the exit code its end.

3. **Install runs the vendor's own installer**, for the Person alone: no
   administrator, no `sudo`, no npm, no Node.

   | | Linux and macOS | Windows |
   |---|---|---|
   | Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` in PowerShell |
   | Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `irm https://chatgpt.com/codex/install.ps1 \| iex` in PowerShell |

   The step is done when the engine finds the CLI, not when the
   installer ends with 0. A CLI older than its entry's `minimum` is the
   same step, run as its update.

4. **Sign in is the sign-in there is** (ADR 0108, decision 5). The setup
   starts the Harness's first way that needs no key and waits for it.
   That step alone asks: the Person does it, in the browser. Its link is
   lifted from its output; a code the page shows is typed into the sheet.

5. **Git for Windows is no step.** Claude Code needs none on Windows now:
   without Git Bash it uses PowerShell for its shell. So no Banda installs
   anything machine-wide and Windows asks for no permission. _Roma said
   yes to installing Git through winget on the word that Claude Code
   needed it; the vendor's page says it does not, so this is his to
   turn._

6. **The row is ADR 0059's, with one button** (its decision 4). Its
   states: Not on this computer (Set up), Setting up · 1 of 2 (Show),
   Waits for you to sign in (Sign in), Stopped with why (Try again),
   Older than Banda needs (Update), Can't tell (Check again), and ready,
   with who is signed in. It shows where 0059 said: New Thread until one
   Harness is ready, Settings, and a Thread whose turn needs it.

7. **Set up opens a sheet of the steps**, on the Top layer. _This
   replaces ADR 0059's decision 5, "no wizard"._
   - Every step shows at once, each with its mark, its name and its
     line. One button starts them all. Nothing asks for Next.
   - Colour is for calls alone: orange on the step that waits for the
     Person, red on one that failed, green on one that is done.
   - Closing the sheet stops nothing: the row says where the setup is,
     and Show opens it again.
   - Ready, its button is "Write the first message".

8. **What an installer prints is under Details**, in the sheet. _This
   replaces ADR 0059's decision 6, the terminal Pane beside the card._
   It opens by itself on a step that failed, under one sentence of why,
   with Copy details. A Person who would rather run the command reads it
   there.

9. **The window knows no Harness.** It draws the steps the engine gave,
   in the engine's words, and calls the four methods. No name of a
   Harness, a step or a system is in its code.

10. **A setup runs on the machine whose Harness it is.** Another
    machine's row asks that machine's engine, as its Accounts do (ADR
    0108, decision 1); its sign-in from here goes by a way for a Person
    elsewhere (ADR 0120, decision 3).

**Not decided here.** A Harness that brings its steps in its own entry
or its App's manifest; installing Git, Node or another tool an Agent's
work may want; starter prompts and What's new (ADR 0059, decisions 7 and
8), which stay as they are.

## Steps

1. **The engine**: the steps in `kinds.rs`, the four methods, `banda
   harness setup`, with tests on a stand-in installer on Linux, macOS
   and Windows.
2. **The row and the sheet**, by the mock, in Settings and in a Thread.
3. **The card in New Thread** until one Harness is ready.
4. **Tried by hand** on a Windows with nothing installed, a Mac and a
   Linux: from Banda's installer to an Agent's first answer.

## Consequences

- A Person who is no developer reaches a first answer with two presses
  and one sign-in, and never reads a terminal.
- Banda runs a vendor's script from the network on the Person's word.
  The sheet names the vendor, and Details shows the command.
- A vendor that moves its installer breaks the step until a Banda
  release follows. The step then says Stopped, with what it printed.
- An Agent on Windows with no Git Bash works in PowerShell. A Person who
  wants Bash installs Git themselves.
