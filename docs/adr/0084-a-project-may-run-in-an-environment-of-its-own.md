---
status: accepted
date: 2026-11-06
---

# A Project may run in an environment of its own

_Accepted by Roma on 2026-11-06 with the architecture vision, whose
decisions 11 and 18 it records. Plan step 1 is built: the port, the
`local` adapter, and every program Banda starts for a Project on it.
Its architecture test refuses a process made outside
`banda-environments`, but for the places it names, each with how many
and why, that ask the host about itself or keep Banda's books and run
nothing of a Project's. What step 1 leaves to later steps is under
Plan. Research: docs/research/2026-11-06-architecture-vision.md
§6, and docs/research/2026-11-06-architecture-vision/isolation.md._

Banda starts programs for a Project in about ten places: a Harness's CLI,
and through it every tool an Agent runs; a terminal's shell; git; the
servers a Project starts; the Project's own MCP servers. Each place starts
its program on the host in its own way. Nothing says where a Project's
programs run.

The fence (ADR 0083) keeps Banda's own state, keys and owner access out of
every Agent's shell. It is not a wall around a Project: it does not keep
one Project from the Person's other files, from other Projects or from the
network. For the Person's own code that is enough. Code the Person did not
write, a cloned repository with its hooks, install scripts and MCP
servers, needs a wall around its Project.

VS Code's dev containers run the editor's own server inside the box.
Codex and Claude Code bring sandboxes of their own. Two questions were
weighed: when isolation comes (after the SDK road, or any time after the
fence), and how a box reaches Banda (the gateway's HTTP routes on
loopback, or the same routes on a unix socket mounted into the box).

Roma, 2026-11-06 (the vision's §11):

- decision 5: the fence by default, and containers for foreign code;
- decision 11: isolation may start any time after the fence; v1 is a
  Linux container on the `shared` network;
- decision 14: Agents drive only their own Project's tabs, or a tab the
  Person lends; per-Project browser profiles later;
- decision 18: the door is a unix socket mounted into the box, if a spike
  shows both Harnesses reach Banda's tools through it; otherwise loopback.

**Decision.**

1. **An environment is where a Project's programs run.**
   - The kernel names it as a port, `Environment`, beside `Identity`:
     `spawn`, `pty`, `ports`, `forward`, `door`, `paths`, `status`.
     `Program` moves into the kernel and gains `cwd`.
   - The platform's `environments` provides three adapters:
     - `local`: as today, on the host, under the fence (ADR 0083);
     - `sandbox`: Landlock and seccomp on Linux, Seatbelt on macOS;
     - `container`: Docker or Podman, made from devcontainer.json.
   - A running `sandbox` or `container` is the Project's **box**.
   - A microVM (gVisor's `runsc`, Kata, Apple's `container`) is a runtime
     the `container` adapter may use, not an adapter of its own.
   - What a Project chose is the `environment` block of its `project.json`.
     How this host makes boxes (Docker or Podman, the default image, the
     OCI runtime, shared caches) is the host's `environments.toml`
     (ADR 0081 decision 12).

2. **A container is not a host.**
   - The engine, its store and log, the outbox, passes, Harness accounts
     and Usage stay outside the box. The recorder sits outside what it
     records: with the engine inside, code from a hostile repository would
     run as the same user as the store.
   - One host has one writer and one set of accounts (ADR 0081 decisions
     1 and 12). An engine per box would mean pairing, signing in and
     counting Usage per box.
   - A remote machine is a host (ADR 0081), never an environment. A Project
     on another machine is a Project on another host.
   - Nothing of Banda's state is mounted in. The one thing of Banda's
     inside is `banda-run`, read-only: a small static program with no
     store, identity or rights. The engine treats what a box reports
     (ports, processes) as untrusted input.

3. **Paths are the same inside and out.** The Project folder, the account
   folders it uses and the Project's temp folder are mounted at the same
   absolute path. ACP, the CLIs and Banda pass paths to each other, so a
   path means one thing on both sides.

4. **Every program Banda starts for a Project goes through its
   environment.**
   - Threads (through `harnesses`), Terminal, git, pulls, Files and the
     gateway ask the Project's environment, and never start a program
     themselves. An architecture test refuses `Command` outside
     `banda-environments`.
   - An App's `run` capability means "through the Project's environment"
     (ADR 0062 decision 5), so an App's program in an isolated Project runs
     in its box.
   - Banda's own bookkeeping never runs Project content: git's status,
     diff, checkpoints and watch go through one hardened runner that runs
     no hook, filter or helper the Project's config names (ADR 0083,
     decision 5). Files and Visuals read with walled opens. All of it
     works while the box is stopped.
   - The rule in one line: what executes Project content runs in the
     environment; what keeps Banda's books runs on the host and executes
     none of it.

   | Inside the box | Outside, on the host |
   |---|---|
   | Harness CLIs (`claude`, `codex app-server`), so every tool call of an Agent runs in the box | the engine, store, log, passes, outbox; the Harnesses' ACP adapters |
   | the Project's own MCP servers (`.mcp.json`) | Banda's tools for Agents, through the door; the Person's MCP servers, in the gateway |
   | terminals, by default | git bookkeeping, hardened |
   | dev servers and their ports | Files and Visuals' images, walled reads |
   | git acts (commit, push, pull, switch) and their hooks | the Agents' browser |

5. **The Harness's adapter runs on the host, and its CLI runs inside.**
   - The ACP adapters hold no Project code. They run on the host's Node,
     beside the session store of ADR 0078. The box needs the vendor's CLI
     and no Node.
   - Banda declares no ACP file or terminal capability, so every tool call
     an Agent makes (a read, an edit, a shell command) runs in the CLI, and
     so in the box.
   - Claude Code's CLI starts through the Agent SDK's
     `spawnClaudeCodeProcess`, Codex's through `CODEX_PATH` pointing at
     `banda-run`. Both land on the box's `spawn`.
   - The CLI gets an allowlist of environment variables: the Harness's own,
     the Project's id and the entry's. Never the Person's home, SSH agent
     or cloud keys.
   - The Harness's own sandbox is off inside a container: the box is the
     sandbox. The Thread's mode and approvals stay as they are.
   - Finding the CLI and its version runs in the box, so it finds the CLI
     the box has.
   - Banda's default image carries no `claude` or `codex` (ADR 0059
     decision 2). The vendors' installers run as the box is made, into its
     home volume, where the CLIs keep updating themselves.

6. **One door inward** (Roma, 2026-11-06, the vision's decision 18).
   - The box reaches Banda only through the door: the gateway's routes
     `mcp` (Banda's tools for Agents), `open`, `credential` and `secret`.
   - Every route needs a **door pass**: a pass whose audience is the door.
     The engine's WebSocket API refuses a door pass, and the door refuses
     any other. Door passes end with the box.
   - The door is a unix socket mounted into the box at a fixed path.
     `banda-run` is its only client inside: it relays MCP over stdio and
     carries `open`, `credential` and `secret`. Boxes outlive the engine,
     whose port can change, and on a `private` network a socket needs no
     route back to the engine.
   - If the spike (Plan, step 2) shows a Harness cannot reach Banda's tools
     through it, the same routes and passes listen on loopback instead.
   - The Person's MCP servers stay in the gateway, outside, with their
     credentials. For an isolated Project they are off until the Person
     allows each.
   - A dev tool's "open a browser" inside the box goes through `open`, to
     the Project's profile (decision 9).

7. **A credential given to an environment belongs to its Agents.**
   - Whatever the CLI can use, code in the box can read. So the default is
     an **environment sign-in** per Harness: an account `of` that Harness
     (ADR 0078 decision 1), signed in once in a box's terminal (ADR 0059
     decision 6). It is the same subscription with its own token, revoked
     alone, with no keychain behind it.
   - Mounting the Person's own sign-in is an opt-in, on Linux only: macOS
     keeps it in the Keychain.
   - An API or gateway account's key stays on the host. The CLI asks for it
     through the door's `secret` route, as `banda secret get` (ADR 0078
     decision 1).
   - A sign-in shared by several Projects keeps each Project's transcripts
     and history apart: those folders of the account are mounted per
     Project. The credentials and their lock stay shared, so locking still
     works.
   - A sign-in of its own per Project is an opt-in, for the most
     separation.

8. **Git acts and their hooks run inside.**
   - Commit, push, pull and switch run in the box, because hooks are the
     Project's code.
   - No SSH key or `gh` token is mounted. Banda's git pushes with a
     one-time grant for this Project's remote, which git uses up before any
     hook runs. An Agent's own push becomes a Question: allow once, always
     for this Project, or deny.
   - For a Project the Person has not trusted, `.git/hooks` and
     `.git/config` are read-only inside.
   - What the box writes to executable config (hooks, `core.hooksPath`,
     `.envrc`, `.vscode/`, `.claude/`, `.codex/`, `.husky/`) is flagged in
     the turn's changes, because the Person's own tools outside Banda would
     run it.

9. **Browser profiles are per device and per host.**

   | Profile | Where | Used by |
   |---|---|---|
   | the Person's, `persist:browser` | device | the Person's own tabs, as now |
   | a Project's, `persist:project-<id>` | device | the Person's tabs opened from that Project: Thread links (ADR 0051), previews, `open` from its box |
   | a Web App's | device | that Web App |
   | the Agents' of Project P | host: a Chromium profile under P's data (ADR 0062 decision 12); until then `persist:agents-<project>` on the device | P's Agents only |

   - An isolated Project has its own profile, on by default. Any Project
     may turn one on, for a client's sign-in for example.
   - Agents drive only their own Project's tabs, or a tab the Person lends
     (Roma, 2026-11-06; ADR 0083, decision 4). For an isolated Project
     only its own
     profile's tabs can be lent, unless the Person picks another.
   - A tab carries its Project's sign (ADR 0070). Extensions load into the
     Person's profile only, unless the Person adds them elsewhere; the ad
     blocker loads into all.
   - Moving a login from one profile to another is a command of the
     Person's, never done by itself (later).
   - Profiles never move with a Project: cookies are secrets.

10. **A Project's network is `shared`, `private` or `allowlist`.**
    - `shared` (v1) is the host's network. It walls the disk and processes,
      not what listens on the host's loopback. The switch's details say so,
      and Banda Cloud's hosts never use it.
    - `private` is a network of the box's own. Banda forwards each port it
      listens on.
    - `allowlist` is `private` with an egress proxy: the Harness's API,
      package registries, git hosts and the Person's own additions. What a
      repository proposes needs the Person's yes. An allowlist narrows the
      ways out; it does not close them.
    - A port keeps its number when it is free, because OAuth redirects,
      CORS and hot reload assume it. It shows on the bar with the Project's
      sign (ADR 0044) and opens in the Project's profile.
    - An isolated Project's box lists its own ports, in place of the
      host's scan.

11. **devcontainer.json is untrusted until the Person approves it.**
    - The definition is the folder's devcontainer.json, else Banda's
      default image: Debian slim, git, build tools, ripgrep, Node, Python
      with uv, a user that is not root.
    - Banda drives the reference devcontainer CLI on the host's Node, so
      Features work as they do elsewhere.
    - Before the first build, and whenever its hash changes, Banda leaves
      out what touches the host and shows it: `initializeCommand` (it runs
      on the host), host mounts, run arguments outside an allowlist,
      privileged flags and added capabilities, the Docker socket, and the
      host's network (only Banda sets that).
    - The Person approves the sanitized config's hash
      (`environments.approve`, the Manage right, the Person only). "Allow
      anyway…" brings one item back, the Person only.
    - It is VS Code's Workspace Trust, made explicit.

12. **The box starts when needed, and stops when idle.**
    - It starts with the first turn, terminal, git act or forwarded port,
      with a quiet line in the Thread: "Starting the Project's container…
      · Log".
    - It stops once the Project's Harness processes are idle, no terminal
      is open and nothing was forwarded for a while.
    - A changed definition shows "The environment changed · Rebuild".
      Banda rebuilds only on the Person's word, and waits for working
      Threads as an update does (ADR 0072).
    - Boxes outlive the engine. On start, the engine reconciles the boxes
      that run with those that should, by the label that names each box's
      Project. A CLI whose adapter is gone ends with it.
    - Archiving or removing a Project, or turning its switch off, stops
      the box, and asks before removing it and its volumes.
    - The Project's log keeps the box's life: `environment.built`,
      `.started`, `.stopped`, `.failed`, `.changed`. A Thread shows them as
      quiet lines.
    - Caches are per Project. A cache two Projects share lets one plant a
      package the other installs, so sharing is the host's opt-in, for
      trusted Projects.

13. **One switch per Project: Isolated.**
    - Project settings → **Isolated**: "Agents, terminals and this
      Project's scripts run in a container. Your files stay where they
      are." Under it: a status line (`Running · Debian · 2.1 GB`,
      `Stopped`, `Failed: npm ci exited 1`), Rebuild, Log and Details.
    - Add Project asks once when a folder looks foreign: cloned from a URL,
      a remote whose owner is not the Person, or `.devcontainer/`,
      `.claude/`, `.mcp.json` or `.codex/` in it. "Code you didn't write?
      Run it isolated." It is on for a URL clone and suggested for
      `.devcontainer/`.
    - The same answer sets the Project's trust (ADR 0083, decision 5): an
      isolated Project is not trusted until the Person says so.
    - Off by default for the Person's own folders and for No Project (ADR
      0046).
    - How the box is made is chosen for the Person: a container where
      Docker or Podman is found, else a sandbox, else "Install Docker or
      Podman to isolate".
    - Elsewhere: the Project's sign gets a quiet corner glyph; a
      terminal's header says `container` or `host`, and the Pane menu has
      Open host shell, for the Person only; the Thread's account pill (ADR
      0078 decision 9) shows the environment sign-in; the first Thread with
      none shows "Claude Code · Sign in for this container"; ports and tabs
      carry the Project's sign.
    - Quiet text lines and a log. No spinners.

14. **A Project's environment moves as its definition.**
    - A move (ADR 0081 decision 11) carries the definition, the approved
      hash, the mode, the network and the profile setting, in
      `project.json`.
    - Environment sign-ins, browser profiles and volumes stay behind. The
      target host's accounts are its own, so the Person signs in again
      there, and the CLIs are installed again.
    - The move's check lists what stays behind, and the paths that differ
      between the two hosts, which same-path mounts assume equal. A target
      host that cannot make the same box says so; a weaker box there needs
      the Person's word.

    | | stop and start | rebuild | move |
    |---|---|---|---|
    | the Project folder, uncommitted work | kept | kept | git and a patch |
    | Banda's log, the session store | kept | kept | copied |
    | the box's home volume (the CLIs, shell history) | kept | kept | made again |
    | cache volumes | kept | kept | made again |
    | changes outside volumes (a package an Agent installed) | kept | lost: Banda offers an Agent's task to write it into devcontainer.json | lost |
    | environment sign-ins | kept | kept | signed in again |
    | the Agents' browser profile | kept | kept | stays behind |
    | the definition, approved hash, mode, network, profile setting | kept | kept | moved |

**Open.**

- macOS for v1: OrbStack, Docker Desktop's host network, or Apple's
  `container`. A spike, which also checks the shared credential lock
  across the VM's file sharing.
- A Banda Cloud host (ADR 0081 decision 10): rootless Podman inside the
  VM, or `sandbox` per Project.
- A Project that needs Docker itself (testcontainers): a rootless Docker
  beside its box, or refused.
- A read-only `.git/config` breaks `git push -u` and husky's setup inside
  the box: accept it, or let Banda's git write the upstream on the host
  after a push.
- An Agent's own push in a Project not trusted: a Question every time, or
  refused.
- Visuals and images outside the folder and the temp folder: read through
  `banda-run`, or Agents told to write them into the Project.
- Codex's limits for an account that only a box has: read through a
  running box, or "can't tell".
- Whether caches per Project are too slow in practice. Measured before
  sharing is made easier.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each.
**v1 is steps 0 to 4** (Roma, 2026-11-06, the vision's decision 11).
They start any time after the fence (ADR 0083), and wait for nothing on
the SDK road.

0. Prerequisites, each useful alone: the hardened git runner and the
   trusted flag (ADR 0083's F2), with Files and pulls on it; every
   `banda` call an Agent makes on the Agent's own pass; walled reads for
   Visuals; the ACP adapters as a host package on the host's Node.
1. The port, `Program.cwd` and the `local` adapter. Every spawn site moves
   onto it, with the architecture test. Nothing changes for the Person.
   Built. What it leaves to the steps that need it:
   - The Harness's program on the port is the entry's start, a carried
     Harness's adapter with it, and its CLI is found on the host. The
     adapter on the host and the CLI in the box (decision 5) come with
     step 3.
   - The port does not say whose program it starts. F0 makes it say: a
     Harness's, which `local` fences, or the Person's own terminal or git
     act (ADR 0083, decision 1).
   - A holder stops what it started by its process group on the host,
     and `spawn` starts at once. Before step 3, the port hands back a
     handle that stops what it started, and starts asynchronously, as a
     box may have to start first.
   - One adapter serves every Project. Step 3 picks it per Project, and
     lets a Project's Harness processes go once its environment changes.
2. The door. Passes with an audience first. A spike: both Harnesses reach
   Banda's tools through `banda-run` over a mounted socket; if not,
   loopback (decision 6). The gateway's first slice, Banda's tools only.
   `banda-run` built static for Linux x64 and arm64 and shipped with
   Banda.
3. The `container` adapter on Linux: the devcontainer driver, the
   sanitizer and approval, the default image, same-path mounts, user
   mapping, the `shared` network; start, stop, rebuild and reconcile;
   both CLIs inside; environment sign-ins, and the Person's own on Linux;
   terminals and git acts inside, hooks and config read-only; ports from
   the box; `environments.*` methods and facts; the switch, its status and
   log (a mockup first).
4. A device profile per Project; Agents' tools walled to their Project's
   tabs (with the browser wall, ADR 0083, decision 4); links and
   previews opening in it.

Later, each its own PR:

5. The `sandbox` adapter: Landlock and seccomp in Rust, Seatbelt on macOS.
6. `private` and `allowlist` networks; macOS, after its spike.
7. The host's Chromium per Project, inside the box's network when it is
   `private`; moving a login.
8. The credential broker: one-time grants and Questions for every push, a
   key added by the proxy for API accounts, the SSH agent as an opt-in,
   the Person's MCP servers allowed per Project.
9. Moves and hardening: the definition moves, volumes export, preview
   routes for a remote host and the web client, `runsc` and Kata as the
   host's choice.

**Consequences.**

- Code the Person did not write runs with one switch. Its hooks, install
  scripts and servers reach neither Banda's state nor the Person's keys,
  cookies and other Projects.
- What isolation walls, and what it does not:

  | Threat | Walled | Not walled |
  |---|---|---|
  | an Agent's mistake (`rm -rf ~`) | the host's home and processes | the Project folder, mounted read-write: checkpoints and git guard it |
  | an injection that steals secrets | SSH keys, cookies, the keychain, Banda's state, other Projects | the environment's own token; what leaves through the network the box may use |
  | a hostile repository | its hooks, install scripts and git filters run in the box | the Person's own tools on the host, in that folder: the turn flags changes to executable config |
  | a container escape | — | for hostile code, `runsc` or Kata; rootless Podman or Docker, because the `docker` group is root |

- `shared` isolates the toolchain, not hostile code on the network.
  `private` and `allowlist` come later.
- Every program Banda starts has one chokepoint, so the fence, a box and
  later supervised programs all plug in at one place.
- An isolated Project costs a build, disk for its image and caches, and a
  second sign-in per Harness.
- `docs/architecture.md` gains `environments`, and its check: no
  `Command` outside `banda-environments`.
- `GLOSSARY.md` gains environment, box, door, door pass, Isolated and
  environment sign-in. Terminal says it runs in the box of an isolated
  Project; Extension says the Person's profile, not the one profile.

**Changes.**

- ADR 0003, decision 3, and ADR 0059, decision 2: outside a box, a
  Harness uses the CLI the Person installed. In a box it uses the CLI
  the vendors' installers put there as the box is made, which updates
  itself. Banda still carries neither (decision 5).
- ADR 0013, decision 2 (one profile), as ADR 0083 decision 4 amends it:
  profiles are per device and per host. A Project may have a device
  profile of its own, on by default when isolated, and its Agents have
  their own. So ADR 0005's sign-in profile per Space (decisions 6 and
  15) comes back, as that option.
- ADR 0013, decision 3 ("the Space changes nothing in it"): a tab opened
  from a Project with its own profile opens in that profile. Which tabs
  an Agent may drive (ADR 0013 decision 7, ADR 0029 decision 1) is ADR
  0083's (decision 4); this ADR only uses it.
- ADR 0026, decision 3: Add Project asks once, for a folder that looks
  foreign, whether to run it isolated, and the answer sets its trust.
- ADR 0034, decision 3, as ADR 0083 decision 5 amends it: git acts
  (commit, push, pull, switch) run in the Project's environment, so in an
  isolated Project they and their hooks run in the box (decision 8).
- ADR 0040, decision 6: `banda-harnesses` no longer starts a Harness's
  process itself. It hands a `Program` to the Project's environment, and
  in an isolated Project the CLI runs in the box while its adapter stays
  on the host. The Harnesses stay the host's (decision 1): their entries,
  accounts and adapters.
- ADR 0044, decision 3: an isolated Project's servers are listed by its
  box, not by the host's scan.
- ADR 0059, decision 1: the adapters run on the host's Node, beside the
  session store of ADR 0078, not on the Node inside Electron (decision 5).
- ADR 0081, decision 11: a move carries the Project's environment
  definition; its sign-ins, profiles and volumes stay. Decision 12:
  `environments.toml` is the host's.
