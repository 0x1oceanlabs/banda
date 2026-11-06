# Project isolation: a Project can run in its own environment

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

## 0. Decisions in brief

1. **An environment is where a Project's programs run.** The kernel names it as a port (`Environment`), the same way it names `Identity` (`kernel/src/api.rs:154`). Platform adapters plug into it: `local` (today's behaviour), `sandbox` (Landlock and seccomp on Linux, Seatbelt on macOS) and `container` (Docker or Podman, driven by devcontainer.json).
2. **A container is not a host.** The engine, the store and log, passes, Harness accounts, Usage and the Agents' browser all stay outside the box. Only programs that execute the Project's code go inside: Harness CLIs, PTYs, git that runs hooks, the Project's own MCP servers, dev servers, and an App's `run`.
3. **A remote machine is a host, never an environment** (ADR 0081). A microVM is a choice of OCI runtime for the container adapter (gVisor `runsc`, Kata, Apple `container`), not a new adapter.
4. **Same-path mounts.** The Project folder, the account folders and the Project's temp folder are mounted at the same absolute path inside the box. Paths are what ACP, the CLIs and Banda pass to each other, so they mean the same thing on both sides.
5. **One door inward and one switch outward.** The box reaches Banda only through one door: an HTTP endpoint on the host, each route gated by a scoped pass. The Person sees one switch per Project, **Isolated**.
6. **v1 is minimal and useful:** the port and every spawn site moved onto it, a container adapter on Linux with host networking, the door, environment sign-ins, git acts inside the box, and a device browser profile per Project.

---

## 1. The concept

### 1.1 What an environment is

An environment is a box with five wires, and nothing else crosses its border.

```
            ┌──────────────── host (banda serve) ────────────────┐
            │ kernel · store/log · passes · platform · Apps       │
            │ harnesses: ACP adapters (Node, ADR 0059)            │
            │ environments: supervisor + adapters + door + fwd    │
            └──┬──────────┬───────────┬──────────┬─────────┬─────┘
       mounts  │   exec   │   ports   │   door   │ egress  │
   (same path) │ (spawn,  │ (listen-  │ (HTTP,   │ (shared │
               │  pty)    │  ing list)│  passes) │ /proxy) │
            ┌──▼──────────▼───────────▼──────────▼─────────▼─────┐
            │ environment of Project P                              │
            │ claude / codex app-server · shells · git (acts,       │
            │ hooks) · .mcp.json servers · npm run dev · banda-run   │
            └───────────────────────────────────────────────────────┘
```

| Wire | Input | Output |
|---|---|---|
| **mounts** | Project folder (read-write), the account folders it uses (read-write), `projects/<id>/env/tmp` as `TMPDIR` (read-write), `/.banda/bin` (read-only: `banda-run`) | the same bytes the host sees, with the same inodes |
| **exec** | `Program {program, args, env, cwd}` plus an optional pty size | stdio bytes, exit status |
| **ports** | — | `[{port, address, pid, by: terminal \| agent}]` |
| **door** | HTTP requests from inside, each with a pass | MCP tools, `open`, `credential`, `secret` |
| **egress** | the box's outbound traffic | allowed or refused, by the network mode |

### 1.2 The port

The trait lives in the kernel, about 60 lines, next to `Identity`. It is deep: a small interface that hides Docker, bwrap, devcontainer, `docker exec` lifetimes and forwarding.

```rust
// kernel/src/environment.rs
pub trait Environment: Send + Sync + 'static {
    fn spawn(&self, p: Program, io: Pipes) -> BoxFuture<Result<Child, Refusal>>;   // pipes, own process group
    fn pty(&self, p: Program, size: Size) -> BoxFuture<Result<PtyChild, Refusal>>; // Person's terminal
    fn ports(&self) -> Stream;                       // Listening lists, as terminal.ports today
    fn forward(&self, port: u16) -> BoxFuture<Result<SocketAddr, Refusal>>;        // host address reaching it
    fn door(&self) -> Door;                          // URL + how a pass is carried, as seen from inside
    fn paths(&self) -> &Paths;                       // folder, tmp, account mounts: all same-path
    fn status(&self) -> watch::Receiver<Status>;     // stopped | building | starting | running | failed
}
```

- `Program` moves from `modules/harnesses/engine/src/model.rs:93-97` into the kernel and gains `cwd`.
- `ModuleProject::environment()` returns the Project's environment.
- The `Manifest` in `kernel/src/project.rs:39-71` gains `environment: Option<EnvironmentChoice>`, next to `sees_others`.
- 0062 d5's `run` capability ("Programs, as the Person") is defined as "through the Project's environment". An App's `run` in an isolated Project is therefore isolated too.

### 1.3 Where each part sits

| Layer | Part | Inputs → outputs |
|---|---|---|
| Kernel | `Environment` trait, `Program`, `Manifest.environment`, pass scopes `door.open`, `door.credential`, `door.secret` | — |
| Platform | `platform/environments` (crate `banda-environments`, module `environments`) | `environments.toml` (the host's, per 0081 d12) and the Project's choice → a live `Environment` per Project, lifecycle facts in the Project log |
| Platform | adapters `local.rs`, `sandbox/{landlock,seatbelt}.rs`, `container/{devcontainer,docker}.rs` | a definition → a running box |
| Platform | the door (an axum route on the engine listener) | a pass plus a request → MCP, open, credential, secret |
| Platform | the forwarder and (step 6) the egress proxy | host port ↔ box port; box egress → allowed or refused |
| Tool | `banda-run`: a static musl binary (linux x64 and arm64), about 1 MB, mounted read-only at `/.banda/bin/banda-run`. It is busybox-style: `exec`, `ports`, `open`, `credential`, `secret` | argv and stdio → a child process group, listening ports, door calls |
| Apps | Threads (through harnesses), Terminal, Git, Pulls, Files, the MCP gateway | They call `project.environment()` and **never** spawn programs themselves. An architecture test bans `std::process::Command`, `tokio::process::Command` and `pty_process::Command` outside `banda-environments`. The current spawn sites are `harnesses/acp.rs:89-91`, `harnesses/cli.rs`, `terminal/terminal.rs:59-78`, `terminal/servers.rs`, `git/run.rs:351`, `files/lib.rs:233-249`, `pulls/{lib,github}.rs`, `problems/issue.rs` and `harnesses/limits/codex.rs`. |

The supervisor reuses the pool pattern in `modules/harnesses/engine/src/hosts.rs:1-13`: start on first ask, backoff, idle sweep. It is keyed `(ProjectId, "env")`. That moves toward the digest's single supervisor (§2.8).

### 1.4 Why a container is not a host

- **The recorder must sit outside what it records.** With the engine inside the box, code from a malicious repo would run as the same uid as the store. It could change Banda's own records. No fence (F0) could keep Banda's state and owner access out of its reach.
- **One writer and one account set per host** (0081 d1, d12). An engine per box would mean pairing per box, signing in per box, and Usage split across boxes.
- **Bookkeeping needs local disk.** Files, git checkpoints, the session store (ADR 0078) and Usage journals all read the folder directly. A remote folder would put a network filesystem under every deep module. So a "remote environment" is a Project on another host (0081 d11), not an adapter.
- **What stays inside is small:** `banda-run`, with no store, identity or rights. The engine treats everything it reports (ports, process lists) as untrusted input.

---

## 2. What runs inside and what runs outside

| Thing | Where | Why | Code today → change |
|---|---|---|---|
| Engine, store, log, passes, outbox | **out** | the recorder (§1.4) | — |
| ACP adapters (claude-agent-acp, codex-acp) | **out**, on the host's Node | They hold no Project code. The box then needs only the vendor CLI, with no Node. The ADR 0078 session store stays host-side. | `list.rs:99-110` is Electron-as-Node today; it moves to a host package (map refactor) |
| Harness CLIs (`claude`, `codex app-server`) | **in** | Banda declares no ACP `fs` or `terminal` capability (`agents/engine/src/acp.rs:336-349`), so every tool call of an Agent (Read, Edit, Bash) runs in the CLI. CLI in the box means all Agent acts are in the box. | Claude: the carried SDK shim sets `spawnClaudeCodeProcess` (Agent SDK 0.3.312 `sdk.d.ts:2502-2522`: "run Claude Code in VMs, containers") → `env.spawn`. Codex: `CODEX_PATH` = `banda-run` host shim, because codex-acp spawns `codexPath app-server` with no cwd (`codex-acp dist/index.js:28097-28101, 54223`). The shim forwards an env **allowlist** (`CLAUDE_*`, `ANTHROPIC_*`, `CODEX_*`, `OPENAI_*`, `BANDA_PROJECT`, the entry's `env`), never `HOME`, `SSH_AUTH_SOCK` or `AWS_*`. |
| CLI version check, `located()` | **in** | It must find the CLI the box has | `cli.rs:60-75, 85` run through `env.spawn` |
| Harness-native sandboxes | **off in a container** | Codex's and Claude Code's sandboxes need user namespaces, which Docker's default seccomp blocks. The box is the sandbox. | Banda sets Codex `sandbox_mode="danger-full-access"` through `CODEX_CONFIG` (0062 d16) and leaves the Thread's approval policy as is |
| Banda's tools for Agents (MCP) | **out**, reached through the door | Rights are decided on the host | `acp/opening.rs:76-90` hands over stdio `banda mcp` today. In a box it hands `McpServer::Http {url: door/mcp, headers: Bearer <session pass>}` instead (both adapters declare `mcpCapabilities.http`, 0062 d16). |
| Project MCP servers (`.mcp.json`, `.codex/config.toml`) | **in** | They are the Project's code | The gateway (0062 d10) spawns stdio servers through `env.spawn` |
| Person-level MCP servers (Linear, GitHub…) | **out**, in the gateway | They hold the Person's credentials. The gateway is the credential broker. | They are listed per Project in `environment.mcp = [...]`, **off by default** for an isolated Project |
| Terminal PTYs | **in** by default | The Person's shell should see what the Agents see | `terminal.rs:57-80` → `env.pty`. `terminal.open {where: "environment" \| "host"}`; "host" exists for the Person only (the terminal has only the `Run` right, `terminal/lib.rs:1-8`). |
| Dev servers, ports | **in** | Project code | Scanner: `banda-run ports` (inside the box, by ADR 0044 d2's markers) replaces the host `/proc` scan in `servers.rs:1-7, 152-170` for box Projects |
| git **acts** (commit, push, pull, switch) | **in** | They run the Project's hooks (`git/act.rs:6`, `lib.rs:149`). Hooks are Project code. | `act.rs` runs git through `env.spawn` |
| git **bookkeeping** (status, diff, checkpoints, watch) | **out**, hardened | Fast, works while the box is stopped, and never runs Project code | One hardened git runner (F2) that runs no hook, filter or other program the Project's config names. Files and pulls move onto it. |
| Files (list, read, write, search, thumbs) | **out** | bytes only, no exec | Walled reads use `openat2(RESOLVE_BENEATH)` on Linux and `O_NOFOLLOW_ANY` on macOS. |
| Visuals' local images | **out**, walled | bytes only, no exec | Walled with `Reach` (folder plus env tmp) for isolated Projects |
| Usage and limits | **out** | Account folders are on the host at the same path, so journals land there | Add the per-Project over-mounts (§4.3) to the journal roots |
| Agents' browser | **out** (the device now, host Chromium later) | §3 | — |
| Pulls (`gh` reads) | **out**, hardened git env | Banda's own reads with the Person's token | — |

The rule in one line: **Banda's own bookkeeping runs on the host and never executes Project content. Anything that executes Project content runs in the environment.**

---

## 3. Browser profile per Project

A **profile** is a named cookie jar plus storage and cache, owned by a device (the Person's) or by a host (the Agents'). ADR 0005 d6/d15 had "one sign-in profile per Space". ADR 0013 d2 replaced it with one profile. Per-Project profiles come back here as an option.

| Profile | Where | Partition or dir | Who uses it |
|---|---|---|---|
| Person | device | `persist:browser` (as now) | the Person's tabs, the default |
| Project | device | `persist:project-<id>` | the Person's tabs opened from that Project: Thread links (ADR 0051), previews, `open` from the box. **On by default** when isolated; can be turned on for any Project (for example a client's Google account). |
| Web App | device | `persist:app-<id>`, or `browser`, or `project` (new value in 0062 d9's `profile`) | Web Apps |
| Agents of Project P | host | `projects/<id>/browser/agents/` as the user-data-dir of the host's headless Chromium (0062 d12) | P's Agents only |

Rules:

- A tab belongs to one profile, and its strip shows the Project's sign (ADR 0070). Extensions load only into the Person profile by default; the ad blocker loads into all.
- **An isolated Project's Agents drive only tabs of their own profile.** The browser engine filters every browser tool by the pass's Project and the tab's partition. The same filter holds for every Project (the browser wall, F1).
- A box reaches the device's browser only through Banda's tools: nothing of the browser's is mounted, and the box's loopback is its own once the network is private.
- **Lending** (ADR 0029 handoff, 0062 d12) is the only way an Agent acts in a device profile. For an isolated Project, only tabs of the Project profile can be lent unless the Person picks another explicitly.
- **Moving a login** is an explicit Person command: `browser.copy_login {site, from, to}`, done with CDP `Storage.getCookies` and `setCookies`, so Agents can work on staging while signed in. It never happens by itself. Planned for step 7.
- **Host Chromium for an isolated Project with a private network** runs as a sidecar in the box's network namespace (`--network container:<box>`) with its user-data-dir mounted. `localhost:5173` then means the same server to the Agent's curl and to its browser, and the egress policy covers the browser too. With a shared network it runs on the host with the per-Project dir.
- **Interim (until 0062 d12):** the Agents' browser is the device's webviews in `persist:project-<id>`.
- Agents' profiles do **not** move with the Project (§5.4): cookies are secrets.

---

## 4. Network and secrets

### 4.1 Network modes (per Project, in `project.json`)

| Mode | Box network | Ports to the Person | Door | Egress | Step |
|---|---|---|---|---|---|
| `shared` | Linux `--network host`. macOS: OrbStack, or Docker Desktop host networking (spike) | They appear on the host's loopback as they are | `http://127.0.0.1:<engine>/door` | as the host's | **v1** |
| `private` | its own bridge network | Banda forwards host `127.0.0.1:P` → box `127.0.0.1:P` through `banda-run` `connect` (dev servers often bind localhost only, so a container-IP route fails) | `banda-run` reverse-forwards an inside `127.0.0.1:<door>` to the engine | open | 6 |
| `allowlist` | `--network internal` plus Banda's egress proxy (`HTTP(S)_PROXY`, CONNECT host check, proxy-only DNS) | as `private` | as `private` | the Harness API hosts, package registries, git hosts, plus the Person's additions in `project.json`. Additions proposed by the repo need approval. | 6 |

- `shared` protects disk and processes, **not** services on loopback: other dev databases, other Projects' servers, a cloud VM's metadata IP. Say so in the UI.
- An allowlist that includes `github.com` still lets an Agent exfiltrate through a gist. An allowlist narrows the exits; it does not close them.

### 4.2 Ports and previews

- **The same number when it is free** (5173 → 5173). OAuth redirect URIs, CORS and Vite HMR assume it. Otherwise the next free port, shown in the bar's ports widget (ADR 0044) with the Project's sign.
- **Methods:** `environments.ports {project}` (a stream) and `environments.forward {project, port} → {address}`.
- **Remote host (0081):** the Electron client opens a local listener and tunnels each TCP connection as a QUIC stream over the host route (a new device capability, `forward`). The web client gets a host preview route per port (a subdomain through the SNI edge of 0081 d4); this is decided with the web client (0081 plan 8).
- A preview opens in the **Project profile**. `BROWSER=/.banda/bin/banda-run open` inside the box sends a dev tool's "open browser" to `browser.open {profile: project}` through the door.

### 4.3 Harness credentials inside the box (ADR 0078 accounts are folders)

| Option | What | Platforms | Default for |
|---|---|---|---|
| **B: environment sign-in** | One account entry per Harness, `of="claude"` or `of="codex"`, folder `~/.local/share/banda/accounts/<id>/`. Signed in once with `claude auth login` or `codex login`, run in a box terminal (ADR 0059 d6). It is the same subscription with a **separate token**, revocable on its own. | Linux and macOS (the default macOS account is in Keychain, so it cannot be mounted) | every isolated Project |
| **A: mount my sign-in** | The Person's main account folder, same path | Linux only | trusted Projects isolated only for the toolchain; opt-in |
| **C: API key or gateway** | ADR 0078 `secrets`. Claude's `apiKeyHelper` or Codex's `auth.command` = `banda-run secret <account>` → door → `banda secret get` | all | API accounts |
| **separate per Project** | B with its own folder per Project | all | opt-in for maximum separation |

- **Account folders shared between Projects** (B and A) are over-mounted per Project so transcripts don't cross. In Claude's folder: `projects/`, `history.jsonl`, `todos/`, `shell-snapshots/`, `file-history/`. In Codex's folder: `sessions/`, `history.jsonl`. They map to `projects/<id>/env/<harness>/…`. The credentials and their lock stay in the shared folder, so locking still works.
- **Codex shadow homes** (ADR 0078 d3) are symlink trees, so the shared `CODEX_HOME` is mounted at the same path as well.
- **What this does not hide:** a credential given to an environment belongs to the Agent. Anything the CLI can use, code in the box can read. B limits the damage: a separate token, revoked alone, and no Keychain access. Keeping a key truly outside needs the egress proxy to inject `x-api-key` or `Authorization` for the API host (step 8). That works for C. For subscription OAuth it does not, because the CLI needs the token itself.

### 4.4 Git credentials

- No credentials are mounted by default: no `~/.ssh`, no `~/.config/gh`, no `~/.git-credentials`.
- **Pushing through Banda's git App:** `git -c credential.helper='!/.banda/bin/banda-run credential' push` runs in the box, with `BANDA_GRANT=<one-time>`. The door answers through the host's helper (`gh auth token`, libsecret or osxkeychain) only for this Project's remote host and path, and only once. Git's own `fill` consumes the grant before `pre-push` runs, so a hook cannot reuse it.
- **An Agent's own `git push` from Bash** has no grant. The door turns the request into a Question ("Push to github.com/x/y?", Allow once / Always for this Project / Deny), using the Decide right.
- **SSH agent:** opt-in per Project. On Linux the socket is bind-mounted; on Docker Desktop it is `/run/host-services/ssh-auth.sock`. While it is mounted, the Agent can use the key, though it cannot copy it.

---

## 5. Lifecycle and state

### 5.1 The definition, in order

1. `.devcontainer/devcontainer.json` or `.devcontainer.json` in the folder.
2. Otherwise Banda's default image (`infra/env/Dockerfile`): Debian slim, git, build tools, ripgrep, Node LTS, Python with uv, a non-root user. **It contains no `claude` or `codex`.** Shipping them in an image Banda publishes would be redistribution, and ADR 0059 d2 says the Person brings the Agents. Instead, the vendor installers run at create time into the box's home volume, where they keep updating themselves. A repo's devcontainer gets Anthropic's `ghcr.io/anthropics/devcontainer-features/claude-code` and the Codex installer through `--additional-features`.
3. Banda drives the reference `@devcontainers/cli`. It is carried on the same host Node as the adapters, so Banda does not re-implement Features. Banda passes:
   - `--override-config`: `workspaceMount` = the folder at the same path, `workspaceFolder` = the same path, `remoteUser` with `updateRemoteUserUID` (Podman: `--userns=keep-id`);
   - `--mount`: accounts, tmp, `/.banda/bin` read-only;
   - `--id-label banda.project=<id>`;
   - `--remote-env`: `BANDA_PROJECT`, `TMPDIR`, `BROWSER`.
4. **devcontainer.json is untrusted input.** Before the first build and on every hash change, Banda strips these and shows them for approval:
   - `initializeCommand`, which **runs on the host**;
   - host `mounts`;
   - `runArgs` outside an allowlist;
   - `privileged`, `capAdd`, `securityOpt`;
   - the Docker socket;
   - `--network host` (only Banda sets it).

   The Person approves the sanitized hash (`environments.approve {project, hash}`, Manage, Person only). This is VS Code's Workspace Trust, made explicit.

### 5.2 States and triggers

| Trigger | Action |
|---|---|
| A turn starts, a terminal opens, a git act runs, or a port is forwarded, while the box is stopped | start (lazily, like `Hosts::get`). The Thread shows a quiet line: "Starting the Project's container… · Log" |
| All Harness hosts of the Project idle (`hosts.rs:22`, 30 min), no terminal, no forwarded traffic for N minutes | stop: let go of the Harness hosts first, then `docker stop` |
| The definition's hash changed | a banner "The environment changed · Rebuild". Rebuilding is never automatic. |
| Rebuild while Threads work | asks first, as ADR 0072's update waits for Threads. Running turns end through the outbox's abandon and settle (`agents/lib.rs:1253-1263`). |
| Engine restart | Boxes outlive the engine, as the machine service does (PR #460). On start, the engine reconciles with `docker ps --filter label=banda.project` (desired state against observed). `banda-run exec` kills its process group when stdin closes, so the CLIs of a dead adapter do not linger. A killed `docker exec` client does not kill what it started. |
| Project archived or removed, or the switch turned off | stop, and ask before removing the box and its volumes |

The lifecycle facts go in the Project's log, so Threads can show a divider: `environment.built {hash, image}`, `.started`, `.stopped {why}`, `.failed {step, tail}`, `.changed {mode}`.

### 5.3 What survives

| | stop / start | rebuild | Project move (0081 d11) |
|---|---|---|---|
| Project folder, uncommitted work | yes | yes | git, plus a patch |
| Banda's log, session store (ADR 0078) | yes | yes | the log is copied |
| Home volume `banda-<p8>-home` (CLIs, shell history, `npm -g`) | yes | yes | no; the CLIs are reinstalled (export as tar later) |
| Cache volumes (npm, cargo, pip, go) | yes | yes | no |
| Changes to the box's filesystem outside volumes (`apt install` by an Agent) | yes | **no** (Banda offers "write it into devcontainer.json" as an Agent task) | no |
| Environment sign-in tokens | yes | yes | **no**: the target host's accounts are its own (0081 d12), and the Person signs in again |
| Agents' browser profile | yes | yes | **no** (secrets) |
| Definition, approved hash, mode, network, browser setting | yes | yes | **yes**: it travels in `project.json`. A target host without Docker falls back to `sandbox`, or the move is refused with a reason. |

Caches are **per Project by default**. A cache shared between Projects is a cache-poisoning channel (a hostile Project plants a package another Project installs). Sharing is opt-in in `environments.toml` for trusted Projects.

### 5.4 Settings ownership (0081 d12)

- `environments.toml` belongs to the host: runtime `docker | podman | auto`, the default image, OCI runtime `runc | runsc | kata`, shared caches.
- The `environment` block in `project.json` belongs to the Project's host.
- A device profile's partition belongs to the device.

---

## 6. Security model

| Threat | Isolation protects | It does not protect |
|---|---|---|
| **Agent mistakes**: `rm -rf ~`, overwriting `~/.config`, killing processes | the host's home and processes outside the box | **the Project folder** (mounted read-write). Checkpoints (`refs/banda/checkpoints`) and git protect it. `push --force` is stopped only by the grant (§4.4). |
| **Prompt injection that steals secrets** | `~/.ssh`, `~/.aws`, browser cookies, Keychain, Banda's own state and owner access (none of it is mounted), other Projects' folders | the account token given to the box; the door's tools; exfiltration through allowed egress, or through the Harness API itself under `shared` or `private` |
| **Malicious repo**: Harness hooks, install scripts, git hooks and config | All of it runs in the box. Banda's host git is hardened (F2). devcontainer.json is sanitized. `.git/hooks` and `.git/config` are mounted **read-only** in the box for untrusted Projects. | **The Person's own tools on the host.** Running `git commit`, `direnv`, `make` or an IDE task outside Banda in that folder runs content the box wrote. Mitigation: Banda's terminal defaults to the box, and changes the box makes to `.git/hooks`, `.git/config`, the `core.hooksPath` target, `.envrc`, `.vscode/*.json`, `.claude/`, `.codex/` and `.husky/` are flagged in the turn's changes as **executable config**. Kernel container escapes are not covered; for hostile code use `runsc`, Kata or Apple `container` (§1, decision 3). |
| **Cross-Project leaks** | other folders are not mounted; the kernel wall (passes name one Project, `kernel/src/passes.rs`); `sees_others` locked off (ADR 0032); per-Project transcript over-mounts, browser profiles and caches; Person-level MCP servers off | a shared environment sign-in token (use "separate per Project") |
| **Third-party Apps** | an App's `run` for an isolated Project runs in its box | Apps are isolated by WASM and capabilities (0062 d4-5), **not** by environments. An App with `files` or `net` reaches what it was granted. |
| **Root-equivalence** | — | Being in the `docker` group is effectively root. Prefer rootless Podman or rootless Docker. Even then, an escape lands as the Person. |

Hardening that comes with it (small, and useful without isolation too):

- every call an Agent makes to Banda carries the Agent's own pass, and owner access stays out of its reach (F0);
- `openat2` for walled reads;
- Visual images walled;
- passes get expiry and are revoked when the box stops;
- the trust step stays separate: until the Person trusts a Project, its Harness sessions read only the Person's own settings; trust is set together with Isolated (§7).

---

## 7. UX

- **One switch:** Project settings → **Isolated**. Subtitle: "Agents, terminals and this Project's scripts run in a container. Your files stay where they are."
  - Below it: a status line (`Running · Debian · 2.1 GB` / `Stopped` / `Failed: npm ci exited 1`), **Rebuild**, **Log** (the build log in a terminal-style Pane), and **Details ▸**.
  - Details: definition, network, accounts, browser profile, caches, MCP servers allowed, how the box is made (`container` or `sandbox`).
- **Add Project** asks once, when the folder looks foreign: cloned from a URL, a git remote owner that is not the Person's `gh` login, or `.devcontainer/`, `.claude/`, `.mcp.json` or `.codex/` present. The question: "Code you didn't write? Run it isolated (recommended)". The switch is preset on for a URL clone and suggested for `.devcontainer/`. This one question covers both the Project's trust and isolation: isolated implies untrusted until the Person says otherwise.
- **Defaults:** off for the Person's own folders and for No Project (ADR 0046). How the box is made is automatic: container if Docker or Podman is found, else sandbox (step 5), else "Install Docker or Podman to isolate". Network `shared` in v1. Accounts B. Browser profile on. Caches per Project.
- **What the Person sees elsewhere:**
  - the Project's sign gets a quiet corner box glyph (ADR 0070 look B); the Pane header capsule shows it;
  - the terminal header says `container` or `host`, and the Pane menu has **Open host shell**;
  - the composer's account pill shows the environment account (ADR 0078 d9 pill);
  - the first Thread with no environment sign-in shows the ADR 0059 row: "Claude Code · Sign in for this container";
  - ports in the bar carry the Project's sign; browser tabs carry it too;
  - the devcontainer approval sheet lists what was left out and why, with "Allow anyway…" for the Person only.
- **No spinners** (Roma's rule): quiet text lines and the log.

---

## 8. Phased plan, ADR decisions, open questions

### 8.1 Plan

Each step is its own PR; `scripts/check.sh` passes after each. **v1 = steps 0-4.**

| Step | What | Size |
|---|---|---|
| 0 | Prerequisites, each useful alone: the hardened git runner (F2; plus files and pulls onto it); every `banda` call an Agent makes on the Agent's own pass; Visuals and `Reach` walled with `openat2`; adapters as a host package with a host Node (map refactor, needed so `banda serve` runs them without Electron, `list.rs:627-645`); the `trusted` flag | M |
| 1 | `Environment` port in the kernel, `Program.cwd`, the `local` adapter. Every spawn site moves onto it, with the architecture test. No behaviour change. | M |
| 2 | The door: an HTTP MCP endpoint on the engine with session passes (the gateway's first slice: Banda's tools only); `opening.rs:76-90` hands HTTP for box Projects. `banda-run` (exec with process-group lifetime, `ports`, `open`, `credential`, `secret`) built static for linux x64 and arm64 in CI and shipped in the app's resources. | M |
| 3 | `container` adapter, Linux first: devcontainer CLI driver, sanitizer plus approval, default image, same-path mounts, uid mapping, `--network host`, lazy start, idle stop, rebuild, reconcile; Claude through `spawnClaudeCodeProcess`, Codex through the `CODEX_PATH` shim; environment sign-in (B) and A on Linux; terminal and git acts in the box; read-only hooks and config; ports through `banda-run`; `environments.*` methods and facts; the switch, status and log in the UI (mockup first). macOS after a spike on OrbStack and Docker Desktop host networking. | L |
| 4 | Device browser profile per Project, Agents' tools walled to the Project's tabs (F1), links and previews opening in it | M |
| 5 | `sandbox` adapter: Landlock and seccomp through `pre_exec` (pure Rust, no bwrap dependency), Seatbelt profile on macOS; a write fence by default, a strict read fence as an option | M |
| 6 | Private network and allowlist: `banda-run` multiplexed frames (`spawn`, `stdin`, `stdout`, `exit`, `signal`, `resize`, `ports`, `connect`, `door`), same-number forwards, egress proxy, macOS parity | L |
| 7 | Host Chromium per Project (with 0062 d12), as a sidecar in the box's network namespace; `browser.copy_login` | M |
| 8 | Credential broker: one-time grants for git plus Questions; key injection by the proxy for API accounts; SSH agent opt-in; Person MCP servers allowed per Project in the gateway | M |
| 9 | Moves and hardening: the definition moves with the Project (0081 d11); volume export; preview routes for remote and web clients; `runsc`, Kata and Apple `container` as an `environments.toml` choice | M |

### 8.2 ADR draft: "A Project may run in an environment of its own"

1. An environment is where a Project's programs run. The kernel names the port; the platform's `environments` module provides `local`, `sandbox` and `container`.
2. A container is not a host: no engine, store, passes or accounts inside. A remote machine is a host (0081). A microVM is an OCI runtime of the container adapter.
3. Mounts keep paths: the folder, account folders and `TMPDIR` are at the same absolute path inside.
4. Every program Banda starts for a Project goes through its environment. Banda's own bookkeeping never runs Project content (hardened git on the host).
5. Adapters run on the host; the Harness's CLI runs inside, through `spawnClaudeCodeProcess` for Claude and `CODEX_PATH` for Codex, with an env allowlist. The Harness's own sandbox is off inside a container.
6. One door inward: an HTTP endpoint whose every route needs a scoped pass (`mcp`, `open`, `credential`, `secret`). Passes end with the box.
7. A credential given to an environment belongs to its Agents. The default is a separate environment sign-in per Harness, with per-Project transcript over-mounts. Mounting the Person's own sign-in is a Linux opt-in.
8. Git acts and their hooks run inside; `.git/hooks` and `.git/config` are read-only inside for untrusted Projects; a push credential crosses only with a one-time grant or the Person's answer.
9. Profiles are per device and per host. An isolated Project gets its own device profile and its Agents' own host profile, and its Agents drive only that Project's tabs.
10. Network modes are `shared` (v1), `private` and `allowlist`. Ports are forwarded with the same number when free and open in the Project's profile.
11. devcontainer.json is untrusted. What touches the host is left out unless the Person approves the config's hash.
12. Lazy start, idle stop, rebuild only on the Person's word, reconcile by labels. §5.3 says what survives.
13. One switch per Project, asked at Add Project for foreign code. It decides the Project's trust together with isolation.
14. A Project's environment moves as its definition; tokens, profiles and volumes do not.

### 8.3 Open questions

1. **macOS networking:** OrbStack, Docker Desktop host networking (beta) or Apple `container` for v1. Needs a spike, including flock across virtiofs for the shared credential lock.
2. **Banda Cloud host** (0081 d10, Fly Machines): rootless Podman nested in the VM, or `sandbox` per Project as that host's default?
3. **Projects that need Docker** (testcontainers): a rootless dind sidecar per box, or refuse?
4. **Read-only `.git/config`** breaks `git push -u` and husky's `core.hooksPath` setup inside the box. Accept it, or let Banda's git App write upstream config on the host after a push?
5. **An Agent's own push in an untrusted Project:** a Question every time, or refused?
6. **Visual and image paths outside the folder and tmp:** read through `banda-run` inside the box (names mean the same inside), or tell Agents to write into the Project?
7. **Codex limits for an environment-only account** when the host has no `codex`: read through a running box, or "can't tell"?
8. **Is per-Project caching too slow** for Roma's Projects in practice? Measure before making shared caches easier to reach.