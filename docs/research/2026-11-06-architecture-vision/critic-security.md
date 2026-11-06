# Banda security and trust critique (2026-11-06)

Input to [the vision](../2026-11-06-architecture-vision.md) (2026-11-06). Roma's decisions are in its §11 and override this document where they differ.

Findings about today's code are tracked privately (SECURITY.md). This document keeps the critique of the proposed designs.

**Thesis.** The proposed capability model is mostly right: one access rule checked at every hop, no hop raises rights, code runs only where its author is trusted, and the cloud only connects. But it rests on an assumption no design states. By default every Agent runs Claude Code or Codex in full access, and an Agent in Full access works with the Person's own rights on the computer. So passes, walls, scopes and the Decide right bind such an Agent only once the fence (F0) keeps Banda's state, keys and owner access out of its reach. Several hosts make it worse: one compromised host can make itself home, rewrite grants and route other hosts' Projects to itself.

| Principal | Trusted in practice today | Should be |
|---|---|---|
| Person on a device | root | root; acts that affect several hosts need the Person present |
| Agent with a shell | equal to the Person (W1) | an OS fence plus a scoped pass |
| App host code (WASM) / worker / view tree | n/a | capabilities ∩ wall / deferred / data only |
| MCP frame, Visual HTML, web page, repo content | Visual: opaque frame; repo content: tracked privately (SECURITY.md) | data, or a frame that never acts as the Person |
| Another host | n/a | semi-trusted: follows and serves, and never vouches for another host |
| Banda Cloud, relay | n/a | connects; never adds a device on its own |

---

## 1. Strengths to keep

- **The command path is security-relevant, not just reliable.**
  - Single writer, receipts and `CommandId` dedupe (`kernel.rs:569-588`).
  - Borders adds `not_after`, enforced in host time, and `expect{seq}`. So an approval sent from a phone never runs hours late, and a replay cannot run twice. Keep "a receipt for every command".
- **An Agent never answers for the Person.**
  - The Decide right: `access.rs:41-43`.
  - A secret typed into a form "goes to the Harness only: neither the log nor the outbox holds it" (`questions.rs:15-16`).
- **`FileLinks` is a correct capability URL; port it as it is.**
  - HMAC with a key per runtime (`desktop-kit/src/files.ts:127-136`).
  - realpath, then `O_NOFOLLOW` (`:145, 192-195`); nosniff; sandbox CSP.
  - Borders makes the token device-bound and read over the same connection. Keep both bindings, and never let it become a bearer HTTPS URL.
- **The Visual frame.**
  - `allow-scripts allow-forms` with no `allow-same-origin`, on an origin apart (`visual-frame.ts:13-22`).
  - A frame can pass the window only an allowlist of keys (`:37-45`).
- **ADR 0081's boundaries.**
  - The engine signs its own sessions, and scopes only narrow.
  - iroh is end to end, keyed by the host key; push payloads are sealed.
  - One VM per Person (no multi-tenant engine). OIDC only finds hosts.
- **Borders:**
  - access = right ∩ capability(via) ∩ scopes ∩ wall, with the wall checked on the resolved ProjectId;
  - intents run as the original actor;
  - the host sends `challenge` first, and `hello` signs the TLS exporter;
  - no client reads the host's disk;
  - `runs_as_person` refuses Agents.
- **View placement C.** No App code reaches a device. The renderer refuses any method that is not the App's own `ui`-marked one ("the client is trusted, the tree is not"). Handlers and views sit behind one wasm wall. Of the three options, this is the strongest security choice.
- **Isolation:**
  - The recorder sits outside the box.
  - devcontainer.json is untrusted until approved by hash (`initializeCommand` runs on the host).
  - Caches are per Project, against poisoning.
  - Changes the box makes to executable config are flagged.
  - The push grant is used once and consumed before `pre-push` runs.
  - The Harness CLI gets an env allowlist with no `SSH_AUTH_SOCK` or `AWS_*`.
  - Agents drive only their own Project's tabs.
  - One question at Add Project sets trust and isolation together.
- **0082:**
  - methods marked `peer`;
  - a cross-host answer is a capability by reference (no token minted);
  - by default no Project accepts work from another;
  - loud capabilities (`threads.send`, `units.start`, `net`);
  - an App never hears events it wrote;
  - finding a process does not grant control of it;
  - the MCP CommandId is derived from the request id.
- **Supply-chain awareness:**
  - 0062 d16 turns off what a Harness would load of its own, and leaves a Project untrusted until the Person trusts it.
  - Apps install by hash, with a capability diff on update.
  - Guard tests: the kernel names no App; no `Command` outside `banda-environments`.

---

## 2. Weaknesses, ranked

**W1. Critical (code and design). A full-access Agent works with the Person's own rights, so every kernel wall needs an OS fence.**
- **The default.**
  - Full access is the default mode: `modules/agents/engine/src/model.rs:60-70` (`#[default] FullAccess`), `sending.rs:143`, ADR 0003 d9 and ADR 0006 d3.
  - It maps to Claude's `bypassPermissions` and Codex's `agent-full-access` (`acp/options.rs:36-41`). An Agent in this mode works with the Person's own rights on the computer.
- **What that reaches today** is tracked privately (SECURITY.md); its fix is F0.
- **ADR 0032's own reason for the wall** ("a Space is often a project of its own, with its files and secrets", `0032:23-27`) holds against an Agent with a shell only once the fence lands.
- **Every new wall in the designs is a file or a socket:** B14 scopes, the door, device keys (0081 d2), host keys, the Person replica. Each binds an Agent with a shell only if the fence hides it.
- **The planned owner-access fix (refactor S3c, isolation §6) is not enough on its own.** The fence below is the fix.
- **Fix: F0, the Banda fence,** before 0081 step 2 and refactor H3.
  - **Where.** `platform/environments::Local` applies the fence in `pre_exec` to every Harness spawn: the adapter process and all its children.
  - **Linux.** A user and mount namespace hides Banda's state, data and runtime folders, and mounts Banda's config read-only. Landlock is a second layer.
  - **macOS.** A Seatbelt profile with the same denies. Codex and Claude Code already sandbox this way, so the cost is known.
  - **Owner access.** It goes through `$XDG_RUNTIME_DIR/banda/owner.sock`, with a peer-uid check (`SO_PEERCRED` / `getpeereid`), and the fence hides the socket. TCP accepts only passes and device signatures.
  - **Costs.**
    - Hiding the session bus breaks `gh`'s and git's keyring helpers and `notify-send`. Give credentials through the gateway (isolation §4.4).
    - Not hiding the bus leaves `systemd-run --user` as an escape.
    - Membership in the `docker` group defeats any fence: detect it and say so.
  - **State it in an ADR and in the UI:** without the fence, "Full access" means "this Agent is you".

**W2.** A security item is tracked privately (see SECURITY.md); its fix is F1, the browser wall.

**W3.** A security item is tracked privately (see SECURITY.md); its fix is F2, hardened bookkeeping git, with the Project trust flag.

**W4. High (design). The Person has no root of trust across hosts.**
- **The home host is the authority for everything Person-scoped:**
  - grants ("per Person, replicated", borders d18);
  - `intents.toml`, `keys.toml`, the directory and the settings.
- **Any host can claim authority:**
  - It can run `person.take --force`.
  - Any host's `projects.located@1{epoch}` wins with a higher epoch.
  - Host keys sit next to full-access Agents (W1).
- **Failure.** A compromised laptop B runs `person.take --force`. B then writes grants and `"run.command" = "evil"` for every host. It also claims ProjectIds, so clients route the Person's sends and answers to B.
- Epochs fence a split brain, not a liar.
- **Fix.**
  - A Person key held only on devices: made on the first device, kept in the OS keystore, gated on the Person's presence where the platform allows.
  - It signs an append-only `person.chain`:
    - the members (devices and hosts, with scopes);
    - home `{key, epoch}`;
    - grant digests;
    - Project moves `{project, from, to, epoch}`, countersigned by the source host.
  - Hosts and clients accept a home, a grant or a location only with a chain entry.

**W5. High (ADR 0081). Pairing brokered by the cloud lets the cloud add a device.**
- 0081 d3: the cloud asks the host to mint a bootstrap for a new key. A breached `api.banda.so`, or a phished account, adds an attacker's device. "A cloud token never opens it" holds only literally.
- **Fix.**
  - A cloud-brokered pairing completes only when an already-paired device, or the host's console, approves it with a matching code. The approval is signed into `person.chain`.
  - Until then the new session is read-only.
  - The device list says "paired through Banda Cloud", with one-tap revoke.

**W6. High (design). The web client's code comes from a host or from Banda.**
- **The pieces.**
  - Refactor W2: the host serves the client.
  - 0081 d4: an SNI edge at `<host>.banda.host`, whose certificates Banda's DNS can obtain.
  - Borders `hello` signs the TLS exporter, which no browser API exposes.
  - The page holds a WebCrypto device key for N hosts.
- **Failure.** One host (an Agent edits the served assets, W1), or Banda Cloud, serves JS that signs as this device to every host.
- **Fix.**
  - Serve the client only from assets compiled into the signed `banda` binary (`include_bytes!` plus a hash check), never from disk.
  - In v1, one browser origin is one host with one device key; merging several hosts is for the desktop and the phone.
  - Prefer iroh-in-WASM, which is end to end to the pinned host key, over the SNI edge.

**W7. High (design). MCP frames and Agent-written HTML act as the Person.**
- **The pieces.**
  - 0062 d10: "a call the UI makes with no model is the Person's act", and `ui/message` goes into the Thread.
  - Refactor D7 turns Visuals into MCP App cards. HTML written by an Agent, or by a web page, then gets a frame whose "own server" is Banda's gateway.
- **Failure.** Acting as the Person, such a frame can answer Questions (Decide), flip `sees_others` (Manage) or call `keys_bind`. Its `ui/message` reads to a full-access Agent as the Person speaking.
- **Fix.**
  - A frame's session is `actor = App("mcp:<server>")`; `only` is the Thread's Project; `scopes` are that server's tools with app visibility, and never Banda's own tools.
  - Writes need a user-activation token that the client renderer mints on a real click and the gateway accepts once.
  - `ui/message` becomes a composer draft the Person sends.
  - Agent-written Visuals keep today's frame, with no `tools/call`.

**W8. High (code and design). Prompts are code, but the designs grade them as Write.**
- **Text that reaches a full-access Agent is `Right::Run`.** The designs give each of these channels less:
  - the `sessions` capability (Threads needs it; 0082 E3 makes only `threads.send` loud);
  - `thread.new@1{ask}`;
  - compositions;
  - acts in view trees (`client.open(intent)`);
  - 0082's cross-host `threads.asked`;
  - `ui/message`.
- **Person acts stored by Agents.**
  - An item about today's code is tracked privately (see SECURITY.md); its fix is B15.
  - The borders design makes `keys.bind` delegable from other hosts.
- **Fix.**
  - One right, `Prompt` (or treat these as `Run`):
    - the Person has it;
    - Apps get it only by a loud grant;
    - an Agent prompts only its own Thread, or another Project through 0082's receiver grant with the mode capped at Supervised.
  - What an Agent writes into the Person's data lands as a proposal: key lines with args, `intents.toml`, Web App manifests, MCP server lists.
  - Trees cannot fire `runs_as_person` intents or `thread.new{ask}`.

**W9. High (design). App capabilities have no wall.**
- **The pieces.**
  - Views, workers and compositions run `via = app`, with no `only`. So an App enabled in Project A `calls` every Project on the host.
  - Borders §3.4 offers a listener over every local Project.
  - View placement §3.3 shares one tree across callers ("safe because one Person"). But an Agent's `banda call habits.today` would get a tree worked out with Person rights.
- **Fix.**
  - Every `via = app` session gets `only` = the Project it runs for.
  - The host-wide listener is for the platform only.
  - `render` runs as `App{app}`, walled to its Project, and the cache key includes the Project.

**W10. Medium-high (code and design). Passes need an audience.**
- **The pieces.**
  - Items about today's passes are tracked privately (see SECURITY.md); their fix is B14.
  - Isolation v1 runs the box on the host network, so it reaches `127.0.0.1:<engine>`. A pass handed to the box for the door must work nowhere else.
  - Refactor S3b persists passes.
- **Fix.**
  - B14 lands before the door.
  - A pass carries `aud` (`ws`, `door` or `gateway`) and a TTL that the gateway refreshes; it is revoked when its session ends and stored hashed.
  - One access rule checks the wall on the resolved ProjectId (B14).

**W11. Medium-high (design). The App supply chain.**
- **The gaps.**
  - Grants are keyed by App id, so new code under the same id inherits them.
  - A Project move installs "from the source's package", which means one host vouches for code.
  - Ids are not namespaced (0082 defers it).
  - `threads.tool.ran@1` carries `command` and up to 64 KiB of output. So `listens` plus `net` exfiltrates every secret an Agent printed.
  - `call@1` needs no declaration, so any App can put "Re-pair Banda · Allow" in the Inbox and on the phone.
- **Fix.**
  - A grant is bound to (id, publisher key, capability set), trusting the publisher's key on first use. A new key means a new App.
  - The installer checks the hash against the chain's grant, whoever ships the bytes.
  - Reserve first-party ids and `banda.*`.
  - Facts carry a sensitivity class. Listening to a sensitive fact is a loud grant; sensitive plus `net` is refused for third parties in v1.
  - The Inbox draws the emitter from the registry, never from the payload.
  - Install the built wasm by hash, and run no build scripts on install.

**W12. Medium (design). Device capabilities that run things.**
- **The pieces.** `open_outside`, `open_editor`, `clipboard`, and `webview` in the Person's profile.
- **Failure.** Any host, compromised as in W4, makes the laptop open a file the host wrote, or opens an OAuth consent page inside a trusted Pane.
- **Fix.**
  - Opening, running or reading the clipboard needs a gesture on that device, unless that device's Person started it.
  - Fetched files carry the macOS quarantine flag and land read-only.
  - Agent-opened addresses use the Agents' partition (the browser wall, F1).

**W13. Medium (design). The Person replica sits on every host.**
- **The pieces.** Every host keeps a replica holding:
  - the arrangement, whose Pane args are URLs and paths;
  - the directory, the settings and the grants.
- Under W1, every Agent on every host reads it. That removes the arrangement's wall: today "no pass follows" the machine scope (`kernel.rs:645`).
- **Fix.**
  - Replicate only what a host needs: its grants, the keys in force and the `intents` defaults.
  - The arrangement and the directory stay on the home host.
  - An Agent's `panes` read goes to home and is filtered there.

**W14. Medium (isolation v1). `shared` means the host's network.**
- **The pieces.** The box reaches:
  - host loopback: the engine API, the door, other Projects' dev servers and local databases;
  - abstract Unix sockets (X11 and the like);
  - the metadata endpoint on a cloud VM.
- The design names only loopback.
- **Fix.**
  - Label v1 "isolates the toolchain, not hostile code".
  - Foreign Projects get the fence plus Supervised mode until `private` lands (step 6).
  - Never use `shared` on Banda Cloud hosts.
  - The door is a Unix socket mounted into the box, not TCP on loopback.

**W15. Medium (design). WASM in the writer, and the SQLite wall.**
- **The pieces.**
  - Borders open question 4 proposes no fuel or deadline for now. One third-party handler can then stall every Thread in its Project.
  - The authorizer as specified checks only the table prefix.
- **Fix.**
  - Fuel, an epoch deadline and a row and byte budget from the first third-party handler.
  - The authorizer refuses `ATTACH`, `DETACH`, any `PRAGMA` off an allowlist, `CREATE TRIGGER` or `VIEW` over another prefix, and functions off an allowlist.
  - `SQLITE_DBCONFIG_DEFENSIVE` on, and `trusted_schema=OFF`.

**W16. Medium (code and design). Secrets at rest, and Electron.**
- **The pieces.**
  - Items about today's desktop build and the processes it starts are tracked privately (see SECURITY.md).
  - On Linux, the keyring (Secret Service) has no per-app permissions, and 0062 d5 maps `secrets` to "the host's keychain".
- **Fix.**
  - S1 and S3 first, so a service binary spawns Harnesses. Add an architecture test: the client spawns no Harness.
  - Then harden the desktop build (the private items above).
  - The engine keeps secrets encrypted under a key the fence hides; the gateway injects them.

**W17. Low-medium.**
- Three items about today's code are tracked privately (see SECURITY.md).
- 0082 restarts Agent-made `units.start` programs at boot (`want = running`), which gives an Agent persistence. Restart only Units the Person confirmed.
- Planned QuickLook, pdfium and ffmpeg thumbnails (`thumb.rs:18-20`) would parse hostile files inside the engine. Run them in a worker or in the box.

---

## 3. Contradictions between the designs

1. **ADR 0032's wall vs the default mode.** 0032 keeps the wall for secrets; ADR 0003 d9 and 0006 d3 default to unsandboxed full access. Borders, B14 and the door add walls on top without touching this.
2. **Trust between hosts.** Borders rule 4 says a host "never trusts another host's decision". Yet d18 replicates grants from home, every host routes by home's directory, and any host may `person.take --force`.
3. **Host-to-host traffic.** Borders rule 6 and d12 say "only two follows, not RPC". But borders §5 forwards `delegable` methods with a delegated pass, which is RPC. And 0082 A4 adds peer `call` frames (`threads.asked`) and a peer `projects.list`.
4. **Who grants cross-host delegation.** Borders: a Person-scope grant written on home and read from replicas. 0082: `threads.allow`, a Project setting on the receiver, written with Manage. The receiver-side grant is the safer one.
5. **Frame authority.** 0062 d10 says a frame's call is "the Person's act". Borders says `via = mcp:<server>`, bounded by capability. 0082 E3 and borders §3.6 say "never the Person's rights". Refactor D7 then routes Agent HTML into the frame path.
6. **Third-party code runtime.** Borders §7 says only first-party workers and WASM handlers until OS sandboxes exist. 0062 d4 and d14 allow workers "in any language", and the view-placement fallback runs "TS views in the App's worker process".
7. **The cloud and devices.** 0081 d3 says "a cloud token never opens it". But the cloud's request makes the host mint a device bootstrap.
8. **Ciphertext only.** 0081 says "relay and push see only ciphertext". But the d4 SNI edge uses certificates Banda's DNS can issue, the host or the cloud serves the web client's JS, and borders' exporter-bound `hello` does not exist in browsers.
9. **Who sees Person-level MCP servers.** Isolation turns them off by default for isolated Projects. 0062 d16 says "each server runs once per host, every Harness sees the same ones".
10. **The shared view cache.** View placement's "one tree shared because one Person" contradicts borders' access rule, under which an Agent and the Person have different rights.
11. **Owner access as a fix.** Refactor S3c and isolation §6 present owner access as fixed. Yet borders and isolation both keep an unfenced Local place, and only the fence (F0) closes it there.
12. A security item is tracked privately (see SECURITY.md); its fix is F1 (W2).
13. **Running programs.** 0062 d5 runs `run` "in a worker only, the Person agreeing". But a view tree's `client.open(intent)` can fire `run.command@1` (`runs_as_person`) from one click.

---

## 4. Cut or defer

- **Gate.** No listener beyond loopback (refactor H4, 0081 step 5) until these land: the F0 fence, B14, F2 with its trust flag (W3) and the F1 browser wall (W2). Today the refactor's shortest path to the web client puts H3 and H4 before any of them.
- **Cut from v1:**
  - `person.take --force`, until the Person chain exists;
  - `delegable` writes from one host to another (an Agent on a non-home host proposes through a `call@1` instead);
  - 0082's peer `call` frames and peer `projects.list`;
  - the SNI edge (use iroh-in-WASM or `direct`);
  - "Visuals become MCP App cards";
  - the fallback that runs TS views in a worker.
- **Defer:**
  - third-party workers, and with them third-party `run`, `net`, `sessions`, `passes.mint` and host-wide `listen`, until there is an OS sandbox;
  - Level 2;
  - Banda Cloud hosts, until the fence and `private` networking;
  - the egress allowlist proxy (it narrows exits and does not close them, as isolation admits);
  - per-Project environment sign-ins as a default (keep them opt-in);
  - macOS container parity.
- **Not worth building:**
  - finer per-Thread browser scoping inside Electron (tab ownership plus partitions are enough);
  - Sigstore-style signing in v1 (trusting a publisher's key on first use, bound into grants, is enough);
  - quorum schemes for the Person key (one device key plus a recovery code).
- **Shrink:** replicate only what each host needs of the Person scope (W13).

---

## 5. The three decisions Roma must make

**1. What is a full-access Agent on a host?**
- **Options.**
  - (a) It is the Person. Say so, and treat walls as guard rails against mistakes.
  - (b) It is fenced by default: the F0 fence hides Banda's state, the owner socket and the keys.
  - (c) Every Project runs in a container.
- **Recommendation: (b), with (c) for foreign code.** Full access stays the default only where the fence holds; otherwise the default is Supervised.
  - It is the only option under which passes, scopes, device and host keys and the Person chain mean anything.
  - The cost is M: Codex and Claude Code already sandbox this way.
  - It lands before 0081 step 2.

**2. Where is the Person's root of trust?**
- **Options.**
  - (a) The home host, which the designs imply.
  - (b) A Person key on devices that signs the chain of members, home, moves and grants.
  - (c) Banda Cloud.
- **Recommendation: (b), in its smallest form:** one key, made on the first device, with a recovery code.
- **What follows from it:**
  - Hosts are semi-trusted.
  - A cloud-brokered pairing needs approval from an existing device.
  - A browser origin serves one host, from assets inside the binary (W6).
- It belongs in 0081 step 2, before the cloud.

**3. Who may act as the Person?**
- **Options.**
  - (a) As drafted: frames, trees, compositions and intent handlers act as the Person within their capabilities.
  - (b) Only a gesture on one of the Person's devices acts as the Person. Everything else acts as itself (`App{app}` or `Agent`), walled to its Project, and text sent to an Agent counts as Run.
- **Recommendation: (b).**
  - Rewrite 0062 d10.
  - Borders' rule "the handler runs as the original actor" holds only within one synchronous call. Rights never travel through the outbox: a worker acts as `App{app}`, and the Person is recorded only as `on_behalf`.
  - What an Agent writes into the Person's data becomes a proposal.
- This one rule closes W7, W8 and W9, and part of W12.