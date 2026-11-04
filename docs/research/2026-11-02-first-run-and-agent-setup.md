# First run: getting a Person's Agents ready

- **Why:** Roma asked to think through Banda's first run: installing Claude Code and Codex, finding them, signing in, and a good path to the first Thread, with the best practice of T3 Code and other agent apps. It is step 7 of ADR 0033 ("A Person's first run"), and it touches ADR 0003, decision 3, and ADR 0004.
- **Sources:**
  - **T**: github.com/pingdotgg/t3code at `c8a601c0` (2026-11-02), clone at `/tmp/t3-onboarding/t3code`. Code and docs read, nothing run.
  - **O**: other products, from their docs, changelogs and, for Emdash and Jean, their source: Emdash, Conductor, Zed, Claude's desktop app, the Codex app, Jean, Paradev (was Superset), Warp, Nimbalyst, JetBrains, opencode. Read on 2026-11-02.
  - **I**: the CLIs' own docs (code.claude.com, learn.chatgpt.com, github.com/openai/codex), npm, Homebrew and AUR metadata, and Roma's machine (`claude` 2.1.316 through mise, `codex` 0.166.0 standalone): only `--help`, `--version` and status commands.
  - **E**: Banda at `df5d28e`.
- **Marks:** **V** = verified, read in code or run. **I** = inferred, our reading.
- **Mockup:** [2026-11-04-first-run-mockup.html](2026-11-04-first-run-mockup.html), the simple plan Roma took.
- **Outcome:** on 2026-11-04 Roma found sections 4–6 too much and took a simpler plan: [ADR 0059](../adr/0059-banda-carries-the-adapters-and-the-person-brings-the-agents.md). Section 7 adds what was measured for it.

## 0. In short

1. **Detect first, ask only for what is missing.** A Person with both CLIs signed in sees no setup at all, only "where to work".
2. **One screen, not a wizard.** It is the empty desk of a first run: the Agents, then where to work. Nothing on it blocks the rest of Banda.
3. **One Harness card, used in three places:** the first run, Settings → Agents, and a Thread whose turn needs a sign-in. Each state has one action.
4. **Banda runs the vendor's own installer, shown first, in a terminal, and reads its exit code.** On success the same terminal goes on to the sign-in. No npm, no sudo.
5. **The engine reads the login shell's PATH** before it looks for a CLI. Today a Banda started from the Dock, or an AppImage from a launcher, may not find `claude` (V, `cli.rs::located` reads the inherited PATH only).
6. **The adapters stop downloading about 800 MB they never use.** `npm_config_omit=optional` on the `npx` start alone cuts it to 92 MB (V, measured). Later: ship them in the app and run them on Electron's Node, so a Person needs no Node.
7. **Sign-in state comes from the CLI, never from its files**: `claude auth status` and `codex login status`, plus the adapters' `_auth/status_update`. Three answers: signed in, signed out, can't tell. "Can't tell" never blocks.

## 1. What Banda does today (E)

- `harnesses.toml` lists Claude Code and Codex by default; each starts an ACP adapter with `npx -y <adapter>@<pinned>` and points it at the Person's CLI (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`; `modules/agents/engine/src/settings.rs:279-315`).
- At each start the engine finds the CLI on PATH and reads `--version`. Missing: "Claude Code runs `claude`, which is not installed on this computer: install it, then check again." Older than `minimum`: it runs, with a warning (`cli.rs:20-50`).
- Sign-in: the ways the adapter declares (ADR 0004), from a failed turn or from Settings → Agents (`SignIn.tsx`, `AgentsSettings.tsx`). The terminal module exists, so a terminal way runs in a Pane.
- No first-run screen. A window with no Space shows the empty Spaces state.

## 2. What the others do

| | First launch | Finding agents | Install | Sign-in | Nothing ready |
|---|---|---|---|---|---|
| **T3 Code** | A modal wizard: Computers → Agents → Projects; only on an empty workspace | Login-shell PATH, then PATH; probes | Types `curl …/install.sh` into a shell terminal without Enter: "Review the command, then press Enter to run it." Codex can also be a binary T3 downloads | Claude: `claude auth login` typed the same way. Codex: "Continue with ChatGPT" (T3 holds the token) | Continue is always on; the composer offers "Open provider settings" |
| **Emdash** (Electron, open source) | Sign in, import; agents in Settings | `which -a`, each install with where it came from (npm, brew, version manager) | Per-OS recipes, Copy and Install; never sudo | `claude auth login`, `codex login --device-auth` in a PTY that picks out the URL; or an API key | Settings → Agents |
| **Conductor** | GitHub, then a first project | Bundles the CLIs | Bundled | Reuses the CLI's login; its `claude /login` terminal closes itself on success and says "Logged in" | Asks for an agent *before* a workspace, "instead of allowing setup to fail" |
| **Zed, JetBrains** | Straight into the editor | The ACP registry | One click; Zed and JetBrains install agents into their own folder with their own Node | Each agent's own, on the first message | Nothing gated |
| **Claude desktop, Code tab** | Sign in, folder, prompt | Bundles Claude Code | Bundled | Anthropic account | Upgrade or sign-in prompt in place; starter prompts ("Find a TODO comment and fix it") |
| **Jean** | Backend picker, checklist, success, tour | PATH, then a login shell | Downloads Claude Code with a checksum and progress | Login terminal; reads URL and device code from its output | Dismissable; then a banner "Setup incomplete … [Complete Setup]" |
| **Paradev** | A checklist: gh, agents, project | Detects both | The Person installs | The CLI's own | "updates live as you install or sign in" |

**Worth taking:**

- T3: the login-shell environment, cached and refreshed in the background (T `DesktopShellEnvironment.ts`); never blocking Continue; a setup that opens by itself only from the home view, so a link never locks anyone out; a compatibility list with a bundled copy and a fetched one; update commands chosen from where the binary lives (T `maintenanceResolver.ts:520-700`).
- Emdash: every install and where it came from; "unknown" as a third sign-in state; adapters run on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), so no `npx`.
- Conductor: the login terminal closes itself and says so. Asking for an Agent at the moment it is needed.
- Jean: the URL and device code lifted out of the terminal into a button.

**Not to take:**

- T3's typed command whose end nobody sees: nothing happens until the Person closes the terminal or 5 minutes pass, and install and sign-in are two trips (T `WelcomeWizard.tsx:1033-1192`).
- T3's close button that quietly marks setup done, and no way back but typing `/welcome`.
- A Refresh button the Person has to press after signing in (Nimbalyst), or knowing to type `/login` (Zed since it dropped its login task).
- Spinners with no end ("Checking provider status" forever: T3 #1787). Every probe has a timeout and an honest end state.
- Treating "can't tell" as "signed out" (T3 PR #787 fixed this for custom Codex providers).

## 3. Facts that shape the design

**Finding the CLIs.**

- macOS apps from Finder or the Dock get launchd's PATH, without `/opt/homebrew/bin`, `~/.local/bin`, mise, nvm, fnm or volta. On Linux it depends on the session: on Omarchy the session PATH holds mise and `~/.local/bin`, but `~/.local/bin` comes *after* `/usr/bin`, unlike in the terminal (V). GNOME and KDE read `~/.profile`, not `~/.bashrc`, where nvm and `mise activate` usually are (I). T3's AppImage reported "Codex CLI is not installed" because its PATH fix was macOS-only (T3 #1139).
- How others fix it: VS Code `$SHELL -i -l -c` printing `process.env` between markers, 10 s; Zed the same through a separate fd so rc noise can't break it; T3 `-ilc` with an allowlist of about 24 variables, 5 s, a cache in the state folder applied at once and refreshed in the background.
- On Omarchy `claude` and `codex` are mise wrappers, `lazy = true`, `auto_update = "4h"` (V, `/etc/mise/conf.d/omarchy-tools.toml`). The first `--version` may download the CLI (I), so a 5 s limit can call it missing.

**Installing.**

| | Recommended | Lands at | Updates itself | Needs Node |
|---|---|---|---|---|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` | yes | no |
| Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `~/.local/bin/codex` | yes | no |

- Homebrew's `claude-code` cask is 2.1.309, older than Banda's minimum 2.1.312; `claude-code@latest` is 2.1.316 (V, brew API). Arch's `openai-codex` is 0.163.0, older than Banda's 0.165.0 (V, `pacman -Si`).
- npm: Arch's npm 12 skips postinstall, so `@anthropic-ai/claude-code` is left with a stub that says "native binary not installed"; global installs need root on a system Node (EACCES), and Claude's docs say never `sudo npm`. Banda should not offer npm.
- Both installers refuse or don't need sudo. The Codex one writes a PATH block into the shell's rc files.

**Signing in, read without touching credentials.**

- `claude auth status --json` exits 0 signed in (`loggedIn`, `authMethod`, `subscriptionType`, `email`), 1 signed out (V). `codex login status` exits 0 with "Logged in using ChatGPT", 1 with "Not logged in" (V). Both adapters push `_auth/status_update` with a label and the account (the sign-in note, section 3).
- `claude auth login` falls back to a pasted code when the browser can't reach localhost; `codex login --device-auth` exists but must first be turned on in ChatGPT's security settings.
- A stray `ANTHROPIC_API_KEY` wins over the subscription silently, as does `CODEX_API_KEY`/`OPENAI_API_KEY` for Codex.

**The adapters' download** (V, measured in a scratch npm cache):

| | `npx` today | with `npm_config_omit=optional` |
|---|---|---|
| codex-acp 2.5.0 | 446 MB (bundles `@openai/codex` for the platform) | 21 MB, 4 s |
| claude-agent-acp 0.99.1 | 351 MB (bundles the SDK's Claude binary) | 71 MB, 17 s |

Both adapters skip their bundled CLI when `CODEX_PATH` / `CLAUDE_CODE_EXECUTABLE` is set, which Banda always sets, so the optional packages are never used. A first Thread today waits for about 800 MB.

**A policy line for Roma** (not legal advice): the Agent SDK overview says "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." `claude-agent-acp` is built on the SDK. Banda runs the Person's own `claude` with their own login, which T3, Zed, Emdash and Conductor do too, but a first-run screen that offers "Sign in with your Claude plan" is close to that sentence. The redistribution terms of `@anthropic-ai/claude-agent-sdk` (Commercial Terms) matter too, if Banda ships the adapter inside the app.

## 4. A proposal

### 4.1 Rules

- **Never gate Banda.** Only sending a message waits for an Agent.
- **Show the command, then run it where it can be seen.** The vendor's own installer and login, in a terminal, never in the background, never with sudo.
- **Banda notices by itself:** a program's exit, the window coming to the front, a look every few minutes. No Refresh button to press.
- **Every check ends:** a timeout gives an honest state with what to do.
- **Banda holds no credentials and reads no credential files** (ADR 0003, 0004). It asks the CLI.

### 4.2 The first-run screen (mockup 1)

- Shown on a machine with no Space, in place of the empty state. It closes once a Space is added, or with Skip. It comes back through the Banda menu ("Agents") and Settings → Agents, which show the same cards.
- **Agents:** a card per Harness in `harnesses.toml`. Both ready: the block shrinks to one line, "Claude Code and Codex are ready".
- **Where to work:** Add Space, and, if Roma agrees, recent folders the Person used with Claude Code or Codex (folder names from `~/.claude/projects` and Codex's sessions; no history imported, so no credential file is read).
- No theme step (the Look follows Omarchy), no tour. One quiet line names Alt+Space.

### 4.3 A Harness card and its states (mockup 3)

| State | What it says | The one action |
|---|---|---|
| Checking | "Looking for `claude` in your shell's PATH" | none; ends in 20 s at most |
| Not on this computer | the recommended command | **Install** (and Copy, Other ways) |
| Older than Banda needs | version, where it came from, the minimum | **Update**, the command chosen by where the CLI lives |
| Not signed in | version and path | **Sign in** |
| Ready | version · signed in · plan; email on click | none |
| Can't tell | "it asks when it must" | none; Threads start |
| Uses an API key | which variable wins over the plan | none; a note |
| Turned off | — | the switch |

The card is one component in `modules/agents/pane`, used by the first run, by Settings → Agents (it replaces `HarnessCard`'s account part), and by a Thread's failed turn (today `SignIn`).

### 4.4 Install and update (mockup 2)

- **Install** runs the command as the terminal's program, shown in the card first, in a terminal inside the card (the terminal module's Pane, in place). Banda knows the exit code, unlike a command typed into a shell:
  - exit 0 → the engine finds the CLI again (with the fresh login-shell PATH) → if it is signed out, the same terminal goes on with the sign-in;
  - not 0, or not found after → the card says which, with the last lines and Copy.
- Commands: the two native installers above, on Linux and macOS. On Omarchy, where mise provides both lazily, "Install" is `mise install claude` (I: to check). Other ways: Homebrew on macOS (`claude-code@latest`, `codex`), AUR on Arch. Never npm.
- **Update** by where the CLI lives: `~/.local/bin` → `claude update` / `codex update`; Homebrew → `brew upgrade --cask …`; mise → `mise up claude`; `/usr/bin` → the pacman line to copy, not run.

### 4.5 Sign-in

- Claude: the adapter's terminal way (ADR 0004), that is the Person's `claude auth login --claudeai`, in the card's terminal; the code can be pasted back there.
- Codex: the adapter signs in in the browser by itself (ADR 0004); "No browser here? Sign in with a code" runs `codex login --device-auth` in the terminal.
- The terminal lifts the URL and a device code into a button and a Copy (Jean, Emdash).
- After: the engine lets go of the Harness's processes (ADR 0004, decision 3), asks again, and the card says "Signed in · Max". The terminal folds away by itself.

### 4.6 When nothing is ready (mockup 4)

- Banda opens fully. A Thread with no ready Harness keeps its composer; the send button becomes **Set up an Agent**, which opens the card for the Thread's Harness. A draft is kept.
- With one of two ready, the new-Thread choice puts the ready one first; the other shows its state in the picker.

### 4.7 Finding the CLIs: the login shell in the engine

- At start, in the background: `$SHELL -l -i -c` printing an allowlist (`PATH`, `HOMEBREW_*`, `SSL_CERT_*`, `NODE_EXTRA_CA_CERTS`, `__MISE_DIFF`, …) between markers; stdin null; killed after 5 s; fish, nu and csh handled; the result cached in the state folder and applied at once next time, as T3 does.
- Then known places for a CLI still not found: `~/.local/bin`, mise's wrappers and shims, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.claude/local`, `~/.codex/packages/standalone/current/bin`.
- The card shows the path, the version and where it came from. `cli.program` already lets a Person point at another one.
- `--version` gets 20 s, with "Checking…" meanwhile, for mise's lazy first run.

### 4.8 The adapters

- **Now:** `npm_config_omit=optional` in the environment of the two `npx` entries: 92 MB instead of about 800 MB, nothing else changes.
- **Later (ADR 0033, decision 8, "packing the adapters into the app"):** ship both at their pinned versions with `--omit=optional`, run with Electron's Node (Electron 45 is Node 24; claude-agent-acp needs 22+) through a small loader that removes `ELECTRON_RUN_AS_NODE` before the adapter starts its CLI, so it never leaks into an Agent's commands. `npx` stays possible as an override in `harnesses.toml`. Then a Person needs no Node at all. Before that: the SDK's redistribution terms.
- The ACP registry (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`) can say that a newer adapter is out (claude-agent-acp 0.100.0 is out today), and later adds Harnesses beyond these two.

## 5. Steps, if Roma takes it

1. `npm_config_omit=optional` on the adapters (one line and a test).
2. The login-shell environment in the engine, known places, a longer version check.
3. The Harness state from the CLIs (`auth status`, `login status`, API-key variables) in `agents.harnesses`, with "can't tell".
4. The one Harness card, in Settings → Agents and in a Thread.
5. Install and update in the card's terminal, with the sign-in after.
6. The first-run screen and "Set up an Agent" in the composer.
7. Later: the adapters inside the app on Electron's Node; the ACP registry.

## 6. Questions for Roma

1. **A wizard or one screen?** The proposal is one screen on the empty desk (T3 has a three-step modal).
2. **Recent folders** from Claude Code's and Codex's own history on the first screen, or only Add Space?
3. **Install from Banda** with the vendor's `curl … | sh` in a terminal after a click, or only show the command to copy?
4. **The Claude plan line** (section 3): go on as T3 and Zed do, or ask Anthropic first?

## 7. Carrying the adapters (added 2026-11-04)

- **Bundled** (V): each adapter installed with `--omit=optional --ignore-scripts` (73 MB and 21 MB of `node_modules`), then bundled by esbuild (`--bundle --platform=node --format=esm --minify`, with a `createRequire` banner): `claude-agent-acp` 0.99.1 is 2.2 MB, `codex-acp` 2.5.0 is 1.1 MB.
- **On Electron's Node** (V): Electron 45 with `ELECTRON_RUN_AS_NODE=1` is Node v24.22.1, above the adapters' `>=22`. Both bundles, given `CLAUDE_CODE_EXECUTABLE` and `CODEX_PATH`, answer ACP `initialize`; Claude's also sends `_auth/status_update`. No prompt was sent, so a whole Thread through a bundle is not yet tried.
- **Fuses** (V): Banda sets no Electron fuses, so `RunAsNode` is on in a packed build too.
- **Size** (V): the Dev build 0.1.0-dev.197 is 158 MB (AppImage) and 163 MB (macOS zip); the two bundles add 3.3 MB.
- **Licenses** (V, npm): both adapters are Apache-2.0, `@openai/codex` is Apache-2.0, `@anthropic-ai/claude-agent-sdk` says "SEE LICENSE IN README.md" (Anthropic's terms). Roma decided to bundle it (ADR 0059).
- **Updating a CLI** (V, `--help`): `claude update` and `codex update` exist.
