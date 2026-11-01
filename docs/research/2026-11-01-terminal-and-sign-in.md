# A terminal Pane and sign-in: T3 Code, Ghostty and Rust PTYs

- **Date:** 2026-11-01.
- **Sources:**
  - **T**: github.com/pingdotgg/t3code at `15fe2832` (2026-10-31), MIT, the
    clone of [the Harnesses note](2026-10-31-t3-code-harnesses.md).
  - **C**, **X**, **S**: claude-agent-acp `eb78afa`, codex-acp `927c480`, the
    ACP spec `b4c72a8`, the clones of [the ACP note](2026-10-31-acp-adapters.md).
  - **GW**: npm `ghostty-web` (registry JSON and the `0.4.0` and
    `0.4.0-next.21.g640db46` tarballs) and github.com/coder/ghostty-web
    through the GitHub API.
  - **Crates**: `crates.io/api/v1/crates/<name>`, and the published sources
    of `portable-pty` 0.9.0 and `pty-process` 0.5.4.
  - **CLI**: `claude` 2.1.316 and `codex-cli` 0.166.0 on Roma's laptop: their
    `--help`, and the field names (not values) of `claude auth status --json`.
  - **E**: Bandaso at `a61a2e9`.
- **How:** we read code and docs, and ran only those help and status
  commands. Web sources were read on 2026-11-01.
- **Limits:** evidence, not a decision. Line numbers drift. "Inferred" marks
  what we concluded rather than read. Sizes are bytes on disk; gzip is
  `gzip -c | wc -c`, not what Vite emits. We ran neither terminal, so nothing
  here says how typing feels.

Short keys, under T unless marked:

| Key | Path |
|---|---|
| `TM` | `apps/server/src/terminal/Manager.ts` |
| `TP` | `apps/server/src/terminal/NodePtyAdapter.ts` |
| `TO` | `apps/server/src/terminal/OutputProtocol.ts` |
| `TC` | `packages/contracts/src/terminal.ts` |
| `G/` | `apps/web/src/terminal/ghostty/` |
| `S/` | `apps/web/src/components/settings/` |
| `PS` | `packages/contracts/src/providerSetup.ts` |
| `SV` | `packages/contracts/src/server.ts` |
| `RA` | `packages/provider-acp-registry/src/server/auth.ts` |
| `WW` | `apps/web/src/components/onboarding/WelcomeWizard.tsx` |

## 1. T3 Code's terminal, end to end

- **The PTY is the server's,** through `node-pty` `^1.2.0-beta.15`
  (`apps/server/package.json:64`), spawned as `xterm-256color` (`TP:255-262`;
  Windows sets `TERM` itself, `TP:248-252`). The web never holds a process.
- **Scope:** a thread plus a `terminalId` the *client* chooses; "the server
  never allocates them" (`TC:29-33`). The drawer splits up to 4 per group
  (`apps/web/src/types.ts:35`); the server keeps up to 128 that have stopped
  (`TM:111`).

**Methods** (`packages/contracts/src/rpc.ts:468-474`, `:1543-1581`):

| Method | What it does |
|---|---|
| `terminal.open` | starts it: `cwd`, `cols`/`rows`, `env`, `providerInstanceId` (`TC:36-44`); returns a snapshot |
| `terminal.attach` | a stream: `snapshot`, then events; can open, `restartIfNotRunning`, `resume` (`TC:47-58`) |
| `terminal.observe` | the same stream, read-only |
| `terminal.write` | a string of 1 to 65,536 characters (`TC:64-67`) |
| `terminal.resize` | `cols` 1–1000, `rows` 1–500 (`TC:9-14`) |
| `terminal.clear` / `terminal.close` | empty the history / kill it, optionally deleting the saved history (`TC:80-84`) |

The snapshot holds status (`starting`, `running`, `exited`, `error`), pid,
`history` as one string, exit code and signal, a label, a `sequence` and the
grid size (`TC:87-106`). Events: `output {data}`, `exited`, `closed`,
`error`, `cleared`, `restarted`, and `activity`, which says whether a child
command runs (`TC:147-230`).

- **Wire.** Effect RPC over one WebSocket, JSON (`apps/server/src/ws.ts:3348`).
  Output is a JSON string, not base64: node-pty yields decoded text and the
  server forwards it (`TM:2530-2535`, `:2255-2273`).
- **Flow control.** At most 8 chunks or 64 KiB unacknowledged per stream
  (`TO:9-71`, wired at `ws.ts:3321`). Behind it a stream queues up to 8 MiB;
  past that it drops the queue and starts over from a fresh snapshot
  (`TO:73-75`, `:129-133`, `:171-174`).
- **Replay on reconnect.** The client re-attaches with `resume: true`
  (`packages/client-runtime/src/state/terminal.ts:65-77`), gets the snapshot
  and calls `resetAndWrite(history)`, then appends live output
  (`apps/web/src/components/ThreadTerminalDrawer.tsx:157-166`). History is
  raw output minus query and reply sequences (device status, cursor report,
  DA, DECRQM, XTVERSION, colour queries), so a replay does not answer old
  questions (`TM:1095-1127`, `:1172-1290`). Live output goes unstripped
  (`TM:2264-2273`).
- **Limits.** Server history 5,000 lines and 8 MiB (`TM:94-95`;
  `docs/user/terminal.md:3-8`); client buffer 512 KiB (`TC:6`); renderer
  scrollback 10,000 rows (`G/core.ts:12`, `:260`).
- **History is saved** to a file per terminal, debounced 250 ms
  (`TM:99`, `:1687-1697`, `:1953-1980`). After a server restart, `resume`
  reopens a known terminal from it (`TM:3015-3017`, `:2869-2880`), ending with
  a reset of keyboard, mouse and paste modes so a dead program's modes do
  not stick (`TM:1050-1067`).
- **Lifecycle.** An exit keeps the history and closes that tab
  (`TM:2276-2290`; `ThreadTerminalDrawer.tsx:1321`). `restartIfNotRunning`
  starts it again (`TM:3037-3043`). Close sends SIGTERM, waits 1 s, then
  SIGKILL (`TM:110`, `:1866-1930`). A 1 s process-table poll shows whether a
  command runs (`TM:100-109`).
- **Shell:** `$SHELL`, else bash, then zsh/bash/sh; on Windows pwsh,
  PowerShell, `ComSpec`, cmd (`TM:512-517`, `:606-638`). **cwd:** the
  project or worktree; a bad one is a typed error (`TC:233-272`).
  **env:** the server's, minus `PORT`, Electron and tmux/screen/Zellij keys
  (`TM:116-127`), plus `COLORTERM=truecolor` and fish's terminal queries off
  (`TM:1383-1419`); a caller adds at most 128 variables (`TC:16-22`).
- **Per account:** with `providerInstanceId` the terminal gets that
  account's `CODEX_HOME` or `CLAUDE_CONFIG_DIR` (`TM:1467-1506`, `:1401-1402`).

## 2. The Ghostty part

### T3's own adapter

- **What.** The official `libghostty-vt` C ABI compiled to WASM and driven
  from TypeScript, "intentionally not an xterm compatibility layer"
  (`G/README.md:1-4`). T3's Android terminal uses the same ABI
  (`apps/mobile/modules/t3-terminal/scripts/build-libghostty-android.sh`).
- **Revision.** Ghostty `9f62873b` (`native/libghostty-vt/VERSION`), a commit
  of 2026-06-26 (GitHub API), unpatched. Zig 0.15.2, `wasm32-freestanding`,
  `ReleaseSmall`, stripped, the pin embedded as build metadata
  (`apps/web/scripts/build-libghostty-wasm.sh:11-13`, `:98-111`) and checked
  by a test (`G/runtimeAbi.test.ts:5`). Ghostty is MIT
  (`native/libghostty-vt/LICENSE:1-3`). The header warns the API "is not yet
  stable and is definitely going to change"
  (`native/libghostty-vt/include/ghostty/vt.h:10-11`).
- **Exports used:** the terminal (`new`, `vt_write`, `set`/`get`, resize,
  scroll), render state with row and cell iterators, key and mouse encoders,
  paste encoding, selection and its formatter, hyperlinks, wasm alloc/free,
  and a type-layout JSON for struct offsets (`G/runtime.ts:22-44`;
  `G/core.ts`). Replies the terminal sends back go through a 112-byte
  trampoline wasm (`G/runtime.ts:111-126`, `:194-218`).
- **Renderer:** Canvas 2D, opaque, scaled by `devicePixelRatio`, batching
  backgrounds and style runs (`G/README.md:7`; `G/surface.ts:700`, `:864`;
  `G/renderer.ts:160-310`). No WebGL, no DOM text.
- **Fonts and theme:** any monospace family; a vendored symbols-only Nerd
  Font loads lazily (`G/surface.ts:19-29`, `:53-114`). Foreground,
  background, cursor and the 256-colour palette (`G/core.ts:406-429`), read
  from the app's CSS (`ThreadTerminalDrawer.tsx:320`).
- **Links:** OSC 8 from Ghostty (`G/core.ts:776-800`) and URLs found across
  wrapped lines (`apps/web/src/terminal-links.ts`; `G/surface.ts:227-270`).
  The host decides what opening means; the sign-in terminal opens only
  `http(s)` (`S/ProviderAuthTerminal.tsx:41-46`).
- **Selection, copy, paste:** Ghostty selects and formats
  (`G/core.ts:692-760`, `:881-904`); copy goes through a primed hidden
  textarea, as a canvas has no DOM selection (`G/surface.ts:314-352`); paste
  is Ghostty-encoded, bracketed when asked (`G/core.ts:595-607`);
  middle-click pastes on X11/Wayland (`G/surface.ts:368`).
- **IME:** the hidden textarea's composition events (`G/surface.ts:677`,
  `:1791-1802`).
- **Cost:** `ghostty-vt.wasm` 630,932 bytes (185,871 gzip); the Nerd Font
  1,177,576 bytes, loaded on first use. About 4,300 lines of TypeScript
  (`core` 1,323, `surface` 2,183, `renderer` 312, `runtime` 229, `keyCodes`
  248) and 1,500 of tests. Outside imports are a few helpers: the link finder
  (193 lines), `isMacPlatform`, `isMonospaceFamily`, `observeResize`, a key
  table (`G/surface.ts:1-21`, `G/keyCodes.ts:1`).
- **Interface:** `create(element, {theme, font, onData, onResize,
  onSelectionChange, beforeKey, onLinkActivate, onContextMenu})`, then
  `write`, `resetAndWrite`, `setTheme`, `setFont`, `focus`, `dispose`
  (`G/surface.ts:517-530`, `:668-1061`). The sign-in terminal is 78 lines on
  top (`S/ProviderAuthTerminal.tsx`).

### `ghostty-web` by Coder

| | |
|---|---|
| Latest | `0.4.0`, 2025-12-09; `next` is `0.4.0-next.21.g640db46`, 2026-10-28; 82 versions since 2025-11-13 |
| Licence | MIT, no runtime dependencies |
| API | "aims to be API-compatible with the xterm.js API": `Terminal`, `open`, `write(string \| Uint8Array)`, `onData`, `onResize`, `onTitleChange`, `onBell`, `loadAddon`, `FitAddon`, link providers for OSC 8 and URLs, selection (GW `README.md:48-66`; `dist/index.d.ts:181`, `:1394`, `:1626-2006`) |
| Renderer | `CanvasRenderer` on `getContext("2d")`; WebGL is an open request (#155) |
| Ghostty | submodule `5714ed07`, a commit of 2025-12-01, plus a 1,620-line patch to Ghostty's sources (`patches/ghostty-wasm-api.patch`; `scripts/build-wasm.sh:21-49`) |
| Size | wasm 423,939 bytes; the ESM bundle 702,145 bytes, as it inlines the wasm as a base64 `data:` URL (198,864 gzip) |
| Use | 3,005 stars, 72 open issues, 314,582 downloads in the week to 2026-10-29. Coder's Mux pins `0.4.0-next.7.g03ead6e` beside `@xterm/headless` and `@xterm/addon-serialize` (github.com/coder/mux `package.json:101-102`, `:118`) |
| Activity | bursts on 2026-02-24 and 2026-06-26/28, then one CI commit on 2026-10-28 |
| Open gaps | Korean IME (#119), CJK input position (#97), screen readers (#187), a throw in `render()` stops rendering for good (#189) |

Both parse, draw on Canvas, encode keys and mouse, select, follow OSC 8 and
fit. T3 adds a Ghostty seven months newer through the unpatched ABI, the
IME and copy path, wrapped-line links, font loading and tests. ghostty-web
adds the xterm.js API, so xterm code ports by an import change
(GW `README.md:7`).

### Which for Bandaso's window

**Take T3's adapter**, vendored as one package (`app/terminal`, with T3's and
Ghostty's MIT notices), its WASM built by its script and committed:

- the official ABI, unpatched, at a newer Ghostty. ghostty-web plans to move
  to "a native Ghostty WASM distribution once available"
  (GW `README.md:83`); T3 has;
- it ships daily in Electron and the web, IME and clipboard included;
  ghostty-web's last stable release is eleven months old, its Korean IME bug
  open;
- its interface is narrow and fits a Pane; we need no xterm.js API;
- its cost is 4,300 lines we own, and Zig when we move the pin, which the
  unstable ABI makes real work, as for T3.

Keep the seam: the Pane uses `write`, `resetAndWrite` and callbacks, so
ghostty-web or xterm.js could stand behind it. Fallback, if vendoring is
refused: ghostty-web `0.4.0-next.21`, pinned exactly.

## 3. T3 Code's provider sign-in

**A. An ACP agent with a `terminal` auth method** (Settings → provider →
Account → Sign in). Bandaso's decision matches this one.

1. The server re-reads `authMethods` and picks the method (`RA:227-276`).
2. It closes the ACP connection and spawns the agent's own program with the
   method's args and env in a PTY, 80×24, no shell (`RA:155-180`, `:277-279`).
3. The window gets the last 16 KiB of output with an offset, inside the auth
   state, and sends keys (at most 4,096 characters) and sizes back through
   `respond` (`RA:181-212`; `PS:42-47`, `:67-76`). Not a stream: the whole
   tail travels each time.
4. Exit 0 is success; anything else fails (`RA:221-222`).
5. It starts the agent again and opens a session to verify (`RA:282-294`).
   Phases: `idle`, `starting`, `waiting`, `verifying`, `succeeded`, `failed`,
   `cancelled` (`PS:102-123`).

This is the spec's flow: run the agent's own program with the method's
args, wait for exit 0, then "reconnects and reinitializes the ACP Agent"
(S `authentication.mdx:169-188`). Pass args as separate arguments, not a
shell line, and show args and env first (`:190-195`).

**B. Native Claude and Codex with the person's own login.**

- *Needs sign-in:* Claude's probe reads `initializationResult().account` and
  says unauthenticated only when `tokenSource` is `none` with no key, email
  or plan (`apps/server/src/provider/ClaudeProvider.ts:169-185`, `:340-390`).
  Codex calls `account/read` (the Harnesses note, section 2).
- *Says:* "Claude Code is not authenticated. Run `claude auth login` and try
  again." (`ClaudeProvider.ts:626`); "Run `codex login`"
  (`apps/server/src/provider/CodexProvider.ts:729`). No button in Settings.
- *Signed in as:* the email and a label from the plan or API provider
  (`ClaudeProvider.ts:631-675`).
- *Onboarding* opens a shell terminal with the account's env and types
  `claude auth login` or `codex login` without Enter: "Review the command,
  then press Enter to run it." (`apps/web/src/onboarding/providerReadiness.logic.ts:95-115`;
  `WW:1060-1096`, `:1124-1125`).
- *Checks again* when the panel closes or the shell exits:
  `server.refreshProviders` (`WW:857-860`, `:1163`). In a shell the login's
  end goes unseen. Otherwise every 5 minutes
  (`packages/contracts/src/settings.ts:944`).
- *Sign out:* none for these two (`S/ProviderSettingsPanel.tsx:1314-1369`).

**C. Codex "Connect with ChatGPT":** T3 runs OAuth and holds the tokens (the
Harnesses note, section 2). ADR 0003 refused it.

**Accounts:** one provider instance per account, each with a "CLAUDE_CONFIG_DIR
path", or a "CODEX_HOME path" and a "Shadow home path" that keeps `auth.json`
apart while sharing the rest (`packages/contracts/src/settings.ts:708-735`,
`:629-681`; `apps/server/src/provider/Drivers/CodexHomeLayout.ts:11-40`).
The app advises against several accounts (`S/MultipleAccountsNote.tsx:16-36`).

**The settings page, per provider:**

- *List row:* icon, name, version (`v2.1.316`), a version-advice button, the
  status line, an enable switch, Delete for added instances
  (`S/ProviderInstanceCard.tsx:1060-1150`).
- *Status line:* "Authenticated as `<email>` · `<label>`", the email hidden
  until clicked (`:195-208`, `:909-925`); else "Checking provider status",
  "Disabled", "Not found" ("CLI not detected on PATH"), "Not authenticated",
  "Needs attention", "Unavailable" or "Available", with a dot for warning
  and error (`S/providerStatus.ts:47-104`).
- *Editor sections:* the name (Status, Display name, accent colour); Setup
  (sign-in, where the provider has it); Runtime (binary path, config folder,
  launch arguments, Claude's auto-compact); Environment (variables, each
  maybe sensitive); Models (`S/ProviderInstanceCard.tsx:1213-1333`).
- *Setup → Account* (path A): email, method picker, Sign in / Retry sign-in /
  Change account, Cancel, the terminal, and Sign out after "This stops
  running threads that share this sign-in. Thread history is kept."
  (`S/ProviderAuthenticationSection.tsx:61-93`, `:161-341`).
- *Version advice:* "Limited support", "Unsupported version", "Known broken
  version" or "Update available", "Use v… for full support.", an "Update
  now" or "Install v…" button and a command to copy
  (`S/providerStatus.ts:116-183`; `S/ProviderInstanceCard.tsx:926-1037`).
  Data: `compatibilityAdvisory` (`supported`, `graceful`, `unsupported`,
  `broken`, recommended version or range) and `versionAdvisory` (`current`,
  `behind_latest`, update command) (`SV:152-185`), from T3's manifest (the
  Harnesses note, section 1).
- *Usage* lives elsewhere: a page and under the composer
  (`apps/web/src/components/usage/UsagePage.tsx`,
  `apps/web/src/components/chat/ComposerUsageLimits.tsx`).
- The snapshot: `installed`, `version`, `installedVersion`, `status`
  (`ready`, `warning`, `error`, `disabled`), `auth` (`authenticated`,
  `unauthenticated`, `unknown`; type, label, email, `canLogout`), `message`,
  `usageLimits`, the advisories, `updateState` (`SV:55-73`, `:206-267`).

**Where T3 reads credential files** (Bandaso reads none): Claude's OAuth
token in `<config>/.credentials.json` for reset credits
(`apps/server/src/provider/claudeResetCredits.ts:142`); `~/.codex/auth.json`
and `~/.claude.json` for a telemetry ID
(`apps/server/src/telemetry/Identify.ts:253-271`); Codex shadow homes'
`auth.json`, kept private (`CodexHomeLayout.ts:33`, `:325-340`); other
providers' `auth.json` for usage (e.g.
`packages/provider-cursor/src/server/usageLimits.ts:119`).

**What Bandaso can learn without reading a file:**

- *`_auth/status_update`*, pushed by both adapters: `{kind, label, detail,
  account: {email, organization, plan}}`, `kind` one of `account`,
  `api_key`, `gateway`, `external`, `none` (C `src/auth-status.ts:54-74`;
  X `src/AuthStatusMeta.ts:38-57`). Both push after `initialize` and on
  change; silence means "cannot tell" (C `:11-37`; X `:13-31`). Claude's
  re-reads at each prompt, so a login made elsewhere shows (C `:19-22`).
  Bandaso drops it today (the ACP note, line 58).
- *The CLIs:* `claude auth status --json` gives `loggedIn`, `authMethod`,
  `apiProvider`, `email`, `orgName`, `subscriptionType`, `configDirectory`
  (CLI), and the adapter runs it itself with a 5 s limit (C `:50-52`).
  `codex login status` prints "Logged in using ChatGPT" (CLI).
- *Sign out:* ACP `logout` where `agentCapabilities.auth.logout` is
  advertised (S `authentication.mdx:196-232`), or `claude auth logout` /
  `codex logout` (CLI).
- *The commands:* Claude's adapter offers terminal methods only when the
  client declares `auth.terminal` or `_meta["terminal-auth"]`, and Bandaso
  declares neither (the ACP note, line 51). The subscription method is the
  adapter's program with `--cli auth login --claudeai`
  (C `src/acp-agent.ts:3015-3045`); `--cli` runs `CLAUDE_CODE_EXECUTABLE`
  when set, so the person's own `claude` (C `src/index.ts:13-16`,
  `acp-agent.ts:2152-2155`). Over SSH or with `NO_BROWSER` it offers the TUI
  `/login` instead, because `auth login` falls back to pasting a code
  (C `acp-agent.ts:2983-3005`); in a real PTY that paste works (inferred).
  Codex's adapter has no terminal method (X `docs/air-extensions.md:294`);
  `codex login --device-auth` exists (CLI) and suits a server (inferred).

## 4. A PTY in the Rust engine

| Crate | Version, date | Licence | Async | Windows | Notes |
|---|---|---|---|---|---|
| `portable-pty` (wezterm) | 0.9.0, 2025-02-11 | MIT | no: blocking `Read`/`Write` (`src/lib.rs:88-107`) | ConPTY (`src/lib.rs:400-410`) | `nix` 0.28, `anyhow`, `serial2`, `filedescriptor`. Kill is SIGHUP to the pid, SIGKILL after 5×50 ms, never the group (`src/lib.rs:323-372`). Unreleased fixes on wezterm main: Windows kill (2026-06-07), `windows-sys` (2026-08-25) |
| `pty-process` | 0.5.4, 2026-10-19 | MIT | yes, feature `async`: `Pty` is `AsyncRead + AsyncWrite`, `into_split`, `resize` (`src/pty.rs:45-98`) | no (inferred: rustix pty, no Windows code) | wraps `tokio::process::Command` with `kill_on_drop` (`src/command.rs:81-85`); the child leads a new session with the pty as controlling terminal (`src/lib.rs:28-36`, `src/sys.rs:149-158`). Only `rustix` 1.1.5 and `tokio` |
| `rustix` | 1.1.6, 2026-10-27 | Apache-2.0/MIT | by hand (`AsyncFd`) | no | `openpt`/`grantpt`/`ptsname` (`src/pty.rs:91-171`), `kill_process_group` (`src/process/kill.rs:35`); already in Bandaso (E `Cargo.lock:1534-1535`) |
| `nix` | 0.31.3, 2026-05-11 | MIT | by hand | no | `openpty`, `setsid`, `killpg`; a second libc wrapper |
| `rustix-openpty` | 0.2.0, 2025-03-06 | Apache-2.0/MIT | no | no | `openpty` only |
| `tokio-pty-process` | 0.4.0, 2019-06-05 | MIT/Apache-2.0 | old tokio | no | abandoned |

**Recommendation: `pty-process` with `async`.** It is tokio-native like the
engine (E `Cargo.toml:27`), so a terminal is two tasks and no blocking
thread; it is the freshest; it adds only `rustix`, which we already build.
Its child leads a session, so the group is the child's pid and
`rustix::process::kill_process_group` takes the whole tree: SIGHUP,
SIGTERM, then SIGKILL after a grace, as T3 does (`TM:110`). The tokio child
gives the async `wait()` the sign-in needs. Bandaso names no Windows target;
if one comes, `portable-pty` behind the same small port (open, read, write,
resize, wait, kill).

## 5. A proposed shape for Bandaso

**A module of its own, `terminal`** (`modules/terminal/engine` and `pane`),
not part of agents: a shell Pane and the sign-in are two uses of one thing,
the engine owns every process, and the browser module is its sibling. Its
words: Terminal, its program, its history. Agents asks it for a terminal and
hears when it ends, so they connect by commands and events.

**Methods.** The window chooses the Terminal's ID (a UUIDv7), so a Pane can
open before the answer (as `TC:29-33`).

| Method | Right | What |
|---|---|---|
| `terminal.open {terminal, program?, args?, env?, cwd?, cols, rows, label, for?}` | owner only; not an Agent | no program means the person's login shell in the Space folder; args are argv, never a shell line; `for` names who asked, e.g. `{agents: {sign_in: harness}}` |
| `terminal.write {terminal, data}` | owner | a string of at most 64 KiB |
| `terminal.resize {terminal, cols, rows}` | owner | |
| `terminal.close {terminal}` | owner | SIGHUP, SIGTERM, then SIGKILL after 1 s, to the group |
| `terminal.restart {terminal}` | owner | the same program again |
| `terminal.attach {terminal}` | owner | a stream, below |

**Facts on the log**, small and durable: `terminal.opened`,
`terminal.exited {code, signal}`, `terminal.closed`. Bytes never go there:
the log is never rewritten, and a TUI repaints megabytes.

**Bytes on the WebSocket.** The kernel speaks JSON text frames only
(E `kernel/src/api.rs:274`), and its subscriptions read the log.

- *A streamed call*, one new kernel primitive the browser can reuse:
  `attach {id, space, method, params}` → `chunk {stream, data}` … `end
  {stream, reason}`, and `detach`. The access decision runs at `attach`.
- *Text, for now; not base64 or binary frames.* The engine decodes PTY bytes
  with a streaming UTF-8 decoder that carries up to 3 unfinished bytes into
  the next read; invalid bytes become U+FFFD. The surface takes strings
  (`G/surface.ts:750`) and T3 ships this way. JSON escapes ESC as six bytes;
  binary frames come only if the speed budget catches that.
- *Flow control:* a bounded queue per stream; a client that falls behind
  gets a fresh snapshot, as in T3 (`TO:129-174`) and as the kernel's
  `resync` does for the log (E `kernel/src/api.rs:106-110`).

**Replay.** `attach` sends `snapshot {history, cols, rows, status, seq}`,
then `output {seq, data}`, `resized`, `exited`; the Pane calls
`resetAndWrite(history)`. History lives in memory, bounded (T3's 5,000 lines
and 8 MiB will do), stripped of query and reply sequences as in
`TM:1095-1127`. It is not saved: an engine restart ends the process anyway,
and the Pane says so and offers Restart.

**Sign-in from a Thread.**

1. A turn fails as "sign-in needed" (E `modules/agents/engine/src/acp.rs:1306-1326`);
   the Thread offers **Sign in**.
2. The window picks a Terminal ID, calls `agents.sign_in {harness,
   terminal}`, and opens the terminal Pane on that ID.
3. Agents resolves the command. If the adapter advertised a terminal method
   (Bandaso must then declare `auth.terminal`): the Harness entry's own
   program and env plus the method's args and env (S
   `authentication.mdx:169-188`); for Claude that runs the person's
   `claude auth login --claudeai`. Otherwise the entry's sign-in command,
   text in the Harness list, `codex login` by default. Either way the entry's
   env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) goes along, so a second account
   signs in to its own folder. The Pane shows command and env first (S
   `:190-195`).
4. Agents sends `terminal.open` with `for: {agents: {sign_in: harness}}`.
5. On `terminal.exited` for it, agents checks again: it lets that Harness's
   host go, starts it, reads the first `_auth/status_update`, and publishes
   "signed in as `<label>`, `<email>`" or a failure with the exit code. The
   failed turn keeps Retry (`agents.retry`). The engine does this, so it
   happens even if the Pane was closed.

**On a server** all of this already runs where the Harness runs. The link
the CLI prints opens in the person's browser, as links leave the window
(architecture, "Window"); Claude's code is pasted back into the terminal;
Codex wants `--device-auth` there (inferred).

**For the settings page next**, per Harness entry, reading no credential
file: *installed* (the program starts); *version* (`--version` against the
supported range); *signed in as* (the last `_auth/status_update`: `label`,
`account.email`, `kind`); *Sign in* (the flow above); *Sign out* (ACP
`logout` where advertised, else the CLI's logout in a terminal); *usage*
later.
