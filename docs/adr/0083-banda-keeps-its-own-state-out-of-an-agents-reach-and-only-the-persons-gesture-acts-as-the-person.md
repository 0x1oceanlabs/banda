---
status: accepted
date: 2026-11-06
---

# Banda keeps its own state out of an Agent's reach, and only the Person's gesture acts as the Person

_Accepted by Roma on 2026-11-06, with the architecture vision and every
decision in its §11. This ADR records decisions 5, 6, 7, 12 and 14 and
the security steps of the vision's §8 to §10. Nothing here is built.
Research: docs/research/2026-11-06-architecture-vision.md (§8) and its
critique, docs/research/2026-11-06-architecture-vision/critic-security.md.
Gaps in today's code are tracked privately (SECURITY.md); this ADR states
the rules that will hold._

ADR 0001 decision 9 set the rule: the engine always checks rights itself.
ADR 0019 gave each Agent a pass that names its Thread and keeps it in its
Project, and said plainly what a pass is not: it says who calls, but it is
no wall against a program that wants to lie, so the Thread's mode stays
the wall for what the Agent runs (decision 2). ADR 0032 kept the Project's
wall because a Project holds its files and secrets, and anything an Agent
reads may tell it to look elsewhere.

What the designs since then add:

- Full access is the default mode (ADR 0003 decision 9, ADR 0006
  decision 3). In it an Agent runs programs with the Person's own rights
  on the computer.
- Every wall the designs add is a file, a socket or a key: passes, the
  Project's wall, device and host keys (ADR 0081), an isolated Project's
  door (ADR 0084). Each binds an Agent with a shell only where the
  operating system keeps that shell away from it.
- ADR 0081 gives the engine a listener beyond loopback and lets Banda
  Cloud broker a pairing. It says so itself: the engine's sessions,
  scopes and key checks become the wall that matters.
- ADR 0013 and ADR 0029 let every Agent drive every Tab, the Person's
  signed-in ones too, in the Person's one profile. Roma decided that
  himself, on 2026-11-01 and 2026-11-02.

The vision's rule 6 names what is missing: the recorder sits outside what
it records. On 2026-11-06 Roma took its decisions 5 (the fence by default,
Supervised where it cannot hold, containers for foreign code), 6 (only a
gesture acts as the Person), 7 (a minimal Person key), 12 (the web
client's code from the home host's signed binary) and 14 (the browser
wall).

**Decision.**

1. **The fence keeps Banda's own state, keys and owner access out of
   every Agent's shell** (Roma, 2026-11-06).
   - Every program Banda starts for a Project goes through its
     environment, the one place that spawns (`platform/environments`,
     ADR 0084). The `local` environment fences every Harness it starts:
     the adapter and all its children, before the Harness runs.
   - On Linux, user, mount and PID namespaces hide Banda's state, data
     and runtime folders, and mount Banda's config read-only. Landlock is
     a second layer. On macOS a Seatbelt profile denies the same. Claude
     Code and Codex already sandbox this way.
   - Owner access goes through a socket in the Person's runtime folder.
     The engine asks the operating system which user the peer runs as
     (`SO_PEERCRED`, `getpeereid`) and takes only the Person's. The
     Person's window and CLI on that computer come in this way. It is not
     a secret: a secret can be copied, a peer's user cannot. The fence
     hides the socket.
   - A listener that a network reaches takes only passes and devices'
     signatures, never owner access.
   - The fence hides the session bus too, so keyring helpers (`gh`'s,
     git's) and `notify-send` do not work in an Agent's shell. The
     credentials an Agent needs come through the gateway.
   - A user in the `docker` group can step past any fence. Banda detects
     it and says so.
   - On macOS, the camera, microphone and screen recording the Person
     allows Banda.app stay Banda.app's. The machine's service starts
     Harnesses from its own binary, and a test checks that no client
     starts a Harness.
   - **Full access means "with your rights on this computer" only where
     the fence holds.** There it stays the default: the Agent has the
     Person's files, programs and network, and never Banda's state, keys
     or owner access. Where the fence cannot hold, the default mode is
     Supervised, and the mode menu says that Full access there means
     "this Agent is you". The Person may still pick it.
   - The fence is the floor for every Project. Code the Person did not
     write gets the stronger environment, a box (ADR 0084).

2. **An Agent's calls to Banda carry its own pass.**
   - Every call from inside a Harness, through `banda mcp`, the gateway
     or the `banda` CLI in the Agent's shell, carries the pass of the
     Agent's session, never owner access.
   - A pass names its Agent, Thread and Project. Its scopes are its
     tools, named by App; its wall is its Project.
     - _Built in part on 2026-11-09:_ the pass a Thread's session holds
       names that Thread, and a module reads it as `Call::thread`. The
       pass a Harness process's shells share names none.
   - It has an audience: `ws` (the API), `gateway` (MCP over HTTP) or
     `door` (an isolated Project's way in, ADR 0084). Anywhere else it is
     refused.
   - It expires, and the gateway renews it while the session lives. It
     is revoked when the session ends, or when its Project's box stops.
   - The kernel keeps passes hashed, in the host's own store, so an
     engine restart keeps the passes of the sessions that go on.
   - An App's worker holds a pass of the same kind, as its App, walled to
     the Project it runs for.
   - So, under the fence, a pass is the wall ADR 0019 said it was not.

3. **Only a gesture on one of the Person's devices acts as the Person**
   (Roma, 2026-11-06).
   - A gesture is a click, a key or an answer the Person gives on one of
     their devices. A click in an App's view sends that App's own
     `ui`-marked command, as the Person, from that device.
   - Everything else acts as itself: an App's handlers and workers, its
     views as they render, MCP frames, compositions and intent handlers.
     Its session names the App that acts (`via`), is walled to the
     Project it runs for, and records the Person as `on_behalf`.
     `on_behalf` is a record and gives no rights.
   - Rights never travel through the outbox: work that runs later runs as
     its App. No hop raises rights: not an intent, a composition, a frame
     or a worker.
   - An MCP frame acts as `mcp:<server>`, walled to its Thread's Project,
     and calls only its own server's tools that are shown to apps, never
     Banda's. A write needs a real click: the client mints a one-time
     token on it, and the gateway takes it once. The frame's
     `ui/message` becomes a draft in the Thread's message box, which the
     Person sends. A Visual an Agent wrote keeps today's frame, with no
     tool calls.
   - **Text sent to an Agent counts as running a program** (the Run
     right), not as a write. So an App, a view, a frame or a composition
     prompts an Agent (opens a session, starts a Thread with a message)
     only by a loud grant. ADR 0019 decision 4 stays: an Agent writes to
     another Thread of its Project as itself, and the message says so.
   - **What an Agent writes into the Person's data, or into the host's
     list of MCP servers, becomes a proposal.** Key lines with args,
     intent defaults, Web App manifests and MCP servers (the host's, ADR
     0082 decision 1) reach the Person as a Call, and change nothing
     until the Person accepts. A proposal names its Agent and Thread from
     the pass, never from what the Agent wrote.
   - A host cannot act on a device without a gesture there. A device
     request that opens, runs or reads something (opening a file outside
     Banda, reading the clipboard, opening a page) waits for a gesture on
     that device, unless that device's Person started it. A file fetched
     to a device lands read-only, with the system's quarantine mark where
     it has one.

4. **An Agent sees only its Project's own Tabs and those the Person lends
   it** (Roma, 2026-11-06; it reverses his own ADR 0029 decision 1 and
   ADR 0013 decisions 2 and 7).
   - An Agent sees and drives only the tabs its Project's Agents opened
     and the tabs the Person lent to its Thread. `browser_tabs` lists no
     other.
   - The Person lends a tab by a gesture in it, and takes it back the
     same way. A lend ends too when the tab closes or the Thread's
     session ends.
   - A tab an Agent opens loads in a profile of its Project's own, apart
     from the Person's: `persist:agents-<project>` on the device, until
     the host's Chromium keeps it in the Project's data (ADR 0062
     decision 12). It never moves with a Project: cookies are secrets.
   - An Agent reaches a tab only through that tab's own socket, handed
     out against its pass. Banda offers no endpoint that drives the whole
     browser, to an Agent or to any other program.
   - ADR 0029's tools, marks, site gate and handoff stay, on these tabs.
   - Later: a profile per Project for the Person's own tabs opened from
     it (`persist:project-<id>`), on by default for an isolated Project
     (ADR 0084).

5. **Banda's bookkeeping never runs a Project's content, and a Project is
   trusted before its Harnesses load what it names.**
   - Banda's own git work (status, diffs, checkpoints, a turn's changes)
     goes through one hardened git runner, `platform/git-cli`. It runs no
     hook, filter, diff helper or other program a repository's config
     names, on any call. Later Banda reads git in process (`gix`).
   - A commit or a push the Person or an Agent asks for is not
     bookkeeping. It runs in the Project's environment, with its hooks,
     as git does in a terminal.
   - A Project is trusted or not: a flag only the Person sets, by a
     gesture. Until it is set, a Harness session there reads only the
     Person's own settings. The settings, hooks and MCP servers the
     folder names for a Harness (`.claude/`, `.codex/`, `.mcp.json`)
     wait, as ADR 0062 decision 16 asks.
   - Why: a repository may be anyone's. Bookkeeping runs on every turn
     with nobody looking, so it runs only Banda's own code.

6. **The Person's root of trust is a Person key** (Roma, 2026-11-06).
   - One Ed25519 key, made on the Person's first device and kept in its
     OS keystore. A recovery code, shown once, brings it back when every
     device is lost.
   - It signs a short chain that only grows: the members (devices and
     hosts) and which host is home.
   - Each host keeps a copy of the signed member list in its own store
     and checks every update against the Person key. It is the host's
     record of whom it accepts, not the Person's data.
   - Adding a device or a host needs the Person key. A host accepts a new
     device only with an entry in the chain, or with a code typed on its
     own console.
   - A pairing that Banda Cloud brokers completes only when a device the
     Person already has approves it, with a matching code. Until then the
     new session only reads. The device list says "paired through Banda
     Cloud", with a one-tap revoke.
   - So a host is semi-trusted: it never vouches for another host and
     never adds a device. Banda Cloud never adds one either.
   - Not now: quorum schemes, Sigstore.

7. **The fence lands before pairing** (Roma, 2026-11-06).
   - The fence (F0) lands before ADR 0081's step 2, keys and pairing.
   - No listener leaves loopback (ADR 0081 step 5) before the fence, one
     access rule (B14), the browser wall (F1) and hardened bookkeeping
     (F2).
   - The Person key comes with pairing, before Banda Cloud brokers any
     (ADR 0081 step 9).
   - Isolated Projects may start any time after the fence (ADR 0084).
   - The `ssh` route (ADR 0081, step 5) opens no listener beyond loopback
     and gives no more than the ssh login gives, so it comes before the
     fence; `direct`, pairing and Banda Cloud keep their order. When
     owner access leaves TCP (F0's owner socket), an ssh route over stdio
     comes in the same PR (amended 2026-11-08).

8. **The web client's code comes only from the home host's signed
   binary** (Roma, 2026-11-06, the vision's decision 12).
   - The home host serves it from the binary it runs, never from a
     disk an Agent can edit. The home host already keeps the Person's
     documents, so it adds no new place to trust.
   - From there the client connects to the Person's other hosts.
   - Once Banda Cloud exists, a static build whose hash is published
     may serve it.

**Plan.** Each step its own PR; `scripts/check.sh` passes after each. The
IDs are the vision's (§9.3).

1. **The stopgap**, now. It narrows accidents, not attacks; F0 is the fix.
   - The mode menu says what Full access is: "this Agent is you". It is a
     visible change, so a mockup first.
   - A fix tracked privately (SECURITY.md).
   - The Banda skill teaches `banda settings set` for every change to
     Banda's settings.
2. **F1, the browser wall** (decision 4). It needs nothing else. How a
   lend looks is a mockup first.
3. **F2, hardened bookkeeping** and the Project's trust flag (decision 5).
   It needs nothing else and is born in `platform/`, so it may land
   before the rename.
4. **F0, the fence** (decisions 1 and 2), after the environment port with
   its `local` adapter (A7) and the engine as the machine's service with
   passes kept hashed and expiring (S3, ADR 0086): the port says whose
   program it starts, and the fence goes on every Harness; the owner
   socket; the network listener takes only passes and
   signatures; the default mode follows the fence; the `docker` group
   detected and shown.
5. **B14, one access rule**: the wall checked on the resolved Project, in
   one place; passes with an audience; `via` and `on_behalf` on every
   session (decisions 2 and 3).
6. **B15, proposals**: what an Agent writes into the Person's data or the
   host's list of MCP servers waits for the Person's yes (decision 3).

Then ADR 0081's step 2 (the vision's H3) brings the Person key with
pairing (decision 6). The rest of decision 3 lands with the step that
brings each actor: the device road (E3), the tracer App's worker (V4), and
MCP frames in the gateway (V6). Decision 8 lands with the web client, ADR
0081's step 8.

**Consequences.**

- Where the fence holds, "Full access" no longer means "this Agent is
  you". Where it does not, the mode menu says so.
- The fence does not wall one Project's folder from another's: under it a
  Full access Agent still has the Person's files. A Project that needs
  that wall runs in a box (ADR 0084).
- ADR 0032's wall binds an Agent's calls to Banda once the fence keeps
  owner access out of the Agent's shell, and B14 checks it on the
  resolved Project in one place (decisions 1 and 7).
- Some of the Person's tools stop working in an Agent's shell (keyring
  helpers, `notify-send`). Banda says what the fence hides, and the
  gateway hands over the credentials an Agent needs.
- Banda's config is read-only in an Agent's shell. An Agent changes
  settings, keys and themes through Banda's API with its pass, as the
  skill teaches from step 1.
- An Agent's tabs start signed out, in its Project's profile. To work in
  the Person's signed-in tab, the Agent asks and the Person lends it. The
  Person's own programs lose the endpoint for the whole browser too.
- Diffs and checkpoints show files as git keeps them, with no filter or
  diff helper of the repository applied.
- An App that prompts Agents asks for it out loud, and the Person sees it
  when the App is installed.
- A breach of Banda Cloud, or a phished account, cannot add a device. The
  recovery code is the way back when every device is lost, and Banda says
  so when it shows it.
- `docs/architecture.md` gains a short trust model: the fence, passes, who
  acts as the Person, the Person key.
- `GLOSSARY.md` gains fence, pass, audience, owner socket, gesture,
  proposal, lend, trusted, bookkeeping, Person key and recovery code.

**Changes.**

- ADR 0002 decision 1 ("Settings are text files that people and Agents
  edit"), ADR 0007 decision 10 (an Agent changes the look by editing
  `look.toml`) and ADR 0016 decision 5 (an Agent edits the file): the
  fence mounts Banda's config read-only in an Agent's shell, so an Agent
  changes settings, keys and themes through Banda's API, with its pass
  (decision 1). The files stay the Person's to edit.
- ADR 0003 decision 9 and ADR 0006 decision 3: Full access is the default
  only where the fence holds; elsewhere the default is Supervised
  (decision 1).
- ADR 0013 decision 2: the one profile is the Person's; an Agent's pages
  load in its Project's own (decision 4).
- ADR 0013 decision 7: no endpoint drives the whole browser; an Agent
  reaches a tab through that tab's own socket, by its pass (decision 4).
  ADR 0029's build step 6 ("the CDP endpoint stays, for the Person's own
  programs") goes with it.
- ADR 0019 decision 2: passes are kept hashed, with an audience and an
  expiry, not in memory until the engine ends; under the fence a pass is
  a wall (decision 2).
- ADR 0029 decision 1: an Agent drives only its Project's Agents' tabs and
  the tabs the Person lent it (decision 4).
- ADR 0034 decision 3: Banda's own git reads (status, diffs, checkpoints)
  go through the hardened git runner, which runs nothing a repository's
  config names. A commit or a push the Person or an Agent asks for runs
  in the Project's environment, with its hooks (decision 5).
- ADR 0071 decision 5: an Agent's `keys.bind` with args becomes a
  proposal (decision 3).
- ADR 0080 decision 10: an Agent writes a theme through Banda's API, not
  into the file, once the fence mounts Banda's config read-only
  (decision 1).
- ADR 0081 decision 2: a Person key signs the members; a host accepts a
  device only with an entry in the chain or a code typed on its console
  (decision 6).
- ADR 0081 decision 3: a pairing Banda Cloud brokers needs the approval of
  a device the Person already has, and only reads until then
  (decision 6).
- ADR 0081 decision 4 and plan step 8: the web client's code comes only
  from the home host's signed binary, and later from a build whose hash
  is published (decision 8).
- ADR 0081's plan: the fence before step 2; no listener beyond loopback
  (step 5) before the fence, B14, F1 and F2 (decision 7).
- Decisions 1 and 2, as F0-3a built them (2026-11-08):
  - The fence holds whole where its probe over this Banda's base finds
    user, mount and PID namespaces and Landlock's scopes both, for a user
    outside the `docker` group. Only there is Full access a new Thread's
    default; elsewhere it starts Supervised, and the engine says why.
    macOS and Windows start Supervised until the fence comes there (F0-5).
  - A Thread in Full access that the fence does not keep now, from
    before the fence or chosen where it held, runs Supervised from its
    next turn, and its `thread.configured` says why. Full access the
    Person chose where the fence did not hold, in a Thread's mode menu or
    as a new Thread's mode in Settings → Agents, runs as chosen (Roma's
    call 3 below). Full access the Harness moved to by itself is no one's
    choice.
  - The fence hides the session's runtime folder, the other sessions'
    and the container and machine managers' sockets it knows. A Harness
    gets the Person's GitHub token, as `GH_TOKEN`, and their SSH agent's
    socket, so an Agent signs as the Person's shell does, only in a
    Project the Person said they trust (`trust_said`), and neither in any
    other (Roma's call 2 below). A Project trusted only as nothing marked
    it foreign is not said trusted: the Person says so in its settings,
    or with `projects.trust`; one trusted before the fence was said so
    once by the upgrade (Roma's call 1 below).
  - Until B15, an Agent's `banda settings` goes through the engine (the
    keys part's `settings_set`, `settings_reset` and `settings_rename`,
    until a settings part of its own takes them), which refuses, under
    an Agent's pass, which Harnesses there are and what each runs, a new
    Thread's `mode`, what Agents may do in the browser, and what Banda
    sends: those stay the Person's to set. A key renamed is checked as
    what it becomes too.
  - Where the fence holds, the engine runs its own programs on the host
    (git, gh, and what the look asks of the system) as root installed
    them, with only root's folders on their PATH, and its bookkeeping
    git takes no program or credential helper from the Person's git
    config in their home, and reads no `~/.ssh/config`: Banda's own
    fetch of a remote that needs those fails quietly, and a pull the
    Person asks for runs as their own git does.
    A program found only outside root's folders, as gh under a version
    manager, runs as found, and the engine says so once in its log.
- Roma's calls on F0-3 (2026-11-08):
  1. Every Project trusted before the fence counts as one whose trust
     was said, once. The first engine with the fence marks each Project
     that is trusted at that moment as said, by the upgrade and with when
     (`project.json`'s `said`), so it reads apart from the Person's own
     word; a scratch Project, in No Project, is not marked. A Project made
     since is said only by the trust step, by `projects.add` or
     `projects.create` with `trusted: true`, or by `projects.trust`.
     Built so: the upgrade runs once for the store, which keeps in the
     engine's data that it did, so a manifest from before the fence that
     turns up later, as an older engine run on the store again writes, is
     said by nobody. A Project found in a folder, as engines before
     ADR 0026 kept one in `.banda/`, is foreign, whatever its manifest
     says: not trusted, its trust not said, seeing no other Project, and
     never in a folder a Project names already.
  2. The SSH agent goes with trust, as the GitHub token does: only a
     Project whose trust was said gets the hole for the agent's socket
     and `SSH_AUTH_SOCK`. In any other the variable is unset and nothing
     is bound. The window says so wherever it says what an Agent gets:
     the Fence row, the trust card and the trust step.
     Built so: behind the fence, a program given the agent keeps
     `SSH_AUTH_SOCK` wherever the socket it names is in sight or bound,
     and one not given it starts with every agent's socket in sight
     hidden: the one `SSH_AUTH_SOCK` names, those the Person's ssh config
     names as `IdentityAgent`, ssh-agent's folders in `/tmp`, and
     1Password's, Bitwarden's and GnuPG's. What goes with trust is the
     agent: key files in `~/.ssh` are files in the home, which the fence
     leaves in sight as the rest of it. Where the fence does not hold, the
     variable is all that saying trust gives, so a Project's settings
     offer to say it there too, and say it gives the ssh-agent.
  3. Where the fence does not hold, Full access is the Person's choice
     (the Unfenced mark) only as they chose it in the window: a Thread's
     mode menu, or the new-Thread mode in Settings → Agents, which
     writes `agents.toml` through the engine as the Person, and the
     engine keeps what they chose in its own state. A `full_access` found
     only in `agents.toml`, written by hand or by anything else, is no
     one's: such a Thread starts Supervised, and the mode menu says why,
     as for any other. Where the fence holds, nothing changes.
     Its limit: it counts only where the fence does not hold, and there
     nothing keeps a program the Person runs from what the Person can
     do. The engine's record keeps Full access from a hand edit of
     `agents.toml` and from a program that writes the file, not from an
     Agent that runs commands as the Person.
