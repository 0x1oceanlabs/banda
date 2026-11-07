---
status: accepted
date: 2026-11-04
---

# Banda carries the adapters, and the Person brings the Agents

Step 7 of ADR 0033 is a Person's first run. The evidence is
[the first-run research](../research/2026-11-02-first-run-and-agent-setup.md):
what T3 Code, Emdash, Conductor, Zed, Claude's desktop app and others do,
how Claude Code and Codex install and sign in, and what Banda does today.
A first idea, a Guide module with docs, news and a tour, was too much
("слишком все плохо, надо что то попроще"). This is the simple one, as in
[the mockup](../research/2026-11-04-first-run-mockup.html).

Today a new Person meets three walls:

- The default Harnesses start their ACP adapters with `npx -y`, which
  needs Node on the machine and downloads about 800 MB at the first Thread,
  the vendors' own CLIs bundled again, never used: Banda always points the
  adapters at the Person's CLI (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`).
- The engine looks for `claude` and `codex` on the window's PATH. On
  macOS the window passes the login shell's PATH (`app/desktop/src/login.ts`),
  on Linux it does not, and a Banda started from a launcher may miss
  `~/.local/bin` or mise.
- A missing CLI or a signed-out one is a sentence in Settings and in a
  failed turn, with nothing to press.

**Decision.** Roma decided the points marked _decided_ on 2026-11-04
("1 встраиваем, 2 запускать в терминале рядом"). The rest are our
defaults and stay his to change.

1. **Banda carries both adapters** (_decided_).
   - `@agentclientprotocol/claude-agent-acp` and
     `@agentclientprotocol/codex-acp`, at the versions `harnesses.toml`
     pins today, are bundled with esbuild into one file each, without their
     optional packages (the vendors' CLIs): 2.2 MB and 1.1 MB, against a
     158 MB Dev build. They ship in the app's resources, as `adapters/`.
   - The engine runs them on the Node inside Electron, with
     `ELECTRON_RUN_AS_NODE=1`, as Emdash does. The window tells the engine
     where that binary and the adapters are when it starts it. A checkout
     builds the adapters with the rest and uses Electron from its
     `node_modules`. _Amended at ADR 0062's step S1, 2026-11-07: the
     adapters are the harnesses' host package,
     `platform/harnesses/adapters`, and `banda serve` finds them and a
     Node itself: the adapters beside its program or in its checkout; the
     Electron the window names, else the packed app's own, else a `node`
     on PATH. So an engine started with no window runs them too._
   - An adapter's version moves with Banda's, with the CLI minimum beside
     it, so a Banda and its adapters are tested together.
   - No Node on the machine, no `npx`, and no network at the first Thread.
   - The Claude adapter is built on `@anthropic-ai/claude-agent-sdk`, which
     is under Anthropic's terms, not an open license. T3 Code bundles it
     too. Its notice goes into `THIRD-PARTY-NOTICES.txt` with the others
     (ADR 0038).

2. **The Person brings the Agents.** Banda never carries `claude` or
   `codex`. Claude Code is not Banda's to give away; Codex could be, but
   its updates and its sign-in would then be Banda's too. The CLI a Person
   has, from the vendor's installer, mise or brew, is the one Banda uses,
   and it updates itself.

3. **The engine reads the login shell's PATH on Linux too.** What
   `login.ts` does on macOS it does everywhere a launcher, not a terminal,
   started Banda: `$SHELL -ilc` between markers, at most 5 s, the window's
   own folders after it. A mise wrapper's first `--version` may download
   the CLI, so a check that runs out of time says "can't tell", never
   "not on this computer".

4. **One row per Harness, with one main button.** The same row shows in
   the first run, in Settings → Harnesses, and in a Thread whose turn needs
   it. Its states:
   - **Checking**, with an end: each check has its 5 s.
   - **Not on this computer**: Install, and Copy command beside it.
   - **Older than Banda needs** ("2.1.309 · Banda needs 2.1.312"): Update,
     with the command for where the CLI lives: the vendor's installer
     `claude update` or `codex update`, mise `mise up <tool>`, brew
     `brew upgrade`. Where it can't tell, only Copy command.
   - **Not signed in**: Sign in.
   - **Bills an API key** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or
     `CODEX_API_KEY` is set): it works, and says the key is billed, not the
     plan.
   - **Can't tell**: Check again. It never blocks a Thread.
   - **Stopped** (an install or sign-in that ended with a code): Show
     terminal, Try again.
   - **Ready**, with the account and plan the CLI says.

   Sign-in state comes from the CLI and the adapter: `claude auth status
   --json`, `codex login status`, and `_auth/status_update`. Banda reads
   no credentials (ADR 0004).

5. **The first run is a card in New Thread.** Until one Harness is ready,
   the New Thread Pane shows "Connect an Agent": "Banda works with Claude
   Code or Codex on this computer. One is enough.", the two rows, and that
   the Person's own subscription is used. A Person who has both ready
   never sees it. No wizard, no Guide Pane, no tour; the sharing question
   of ADR 0039 stays the only dialog.

6. **Install and Sign in run in a terminal beside the card** (_decided_).
   - Install opens a terminal Pane next to New Thread, running the vendor's
     own installer: `curl -fsSL https://claude.ai/install.sh | bash` or
     `curl -fsSL https://chatgpt.com/codex/install.sh | sh`. The command is
     the terminal's first line and its title, so the Person sees what runs.
     No npm (on Arch it installs a stub, and global installs want root), no
     sudo.
   - Sign in runs `claude auth login` or `codex login` the same way. The
     sign-in link in its output is lifted onto the row as "Open sign-in
     page"; a pasted code still goes into the terminal.
   - When the command ends with 0, the terminal says so and closes, and the
     row checks again by itself; after an install, the row goes on to Sign
     in. When it ends with another code, the terminal stays and the row says
     Stopped. "I signed in" stays as a way out when Banda can't tell.
   - Copy command is there for a Person who would rather run it themselves.

7. **Ready, the card goes and New Thread stays.** Above the composer,
   three starter prompts until the first Thread: "What can Banda do?",
   "Put a browser next to this Thread", "Make the window lighter". The
   first is how a Person asks about Banda: an ordinary Thread, whose Agent
   has `banda skill` (ADR 0012).

8. **What's new is in the update widget.** When an update is ready, the
   widget's popover (ADR 0041) lists a few of its changes, from the PR
   titles of its release notes (ADR 0033), and "All changes". Nothing opens
   by itself.

9. **`harnesses.toml` still decides.** A Person's own entry with its own
   `command` runs as written, `npx` included. A file that holds today's
   default `npx -y …` command for `claude` or `codex` is read as the
   built-in entry, so the old default moves to the carried adapter by
   itself.

**Not decided here.** A Guide or docs Pane, news from banda.so, a tour.
They can come later, from the modules' `skill/` topics, if the simple run
turns out not to be enough.

## Steps

1. **The adapters ship and run on Electron's Node** (decisions 1, 9): the
   build script, `adapters/` in the resources, the window passing the
   paths, `known()` pointing at them, the notices. A real Claude and Codex
   Thread through the carried adapters, on Linux and on a Mac build.
2. **The login shell's PATH on Linux** (decision 3), and "can't tell" for
   a check that runs out of time.
3. **The row and its states** (decision 4), in Settings → Harnesses and in
   a Thread. Mock first.
4. **The card in New Thread** (decision 5).
5. **Install and Sign in in a terminal beside it** (decision 6): the
   terminal that reports its end, the lifted link, the check after.
6. **Starter prompts and What's new** (decisions 7, 8). Mock first.

## Consequences

- A Person with no Node, on a fresh Mac, gets a working first Thread.
- Each Banda release carries a few MB more and owns its adapters'
  versions: updating an adapter is a Banda change, tested in CI.
- `ELECTRON_RUN_AS_NODE` must stay allowed: no Electron fuse may turn it
  off while the engine depends on it. If the engine later lives apart from
  the window (ADR 0086), it is still given the Electron binary's
  path.
- ADR 0033's step 7 is this ADR.
