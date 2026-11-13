---
status: accepted
date: 2026-11-13
---

# Every client reaches every machine by one road: at its door, by its own key

Roma, on 2026-11-13 (translated): "moving a Thread is a great feature, but
the core is not there. What matters is that using Banda from a client with
different machines is equally convenient: as if everything is on your
device, and it makes no difference to you whether it is on a server or
local. Picture connecting to a server over ssh: you land in the same
terminal as if it stood locally." He approved story 1 as "one Banda on every
machine" and principle 9 of [what we build](../what-we-build.md), and
answered the door's questions: `tailscale serve` for browsers and the phone
until Banda Cloud exists, and the phone's first version as recommended.
Research: `~/Banda/artifacts/what-we-build/same-everywhere/` (not in the
repository), with an adversarial check.

**Where it stands.**

- **Two roads.** The window reaches its own machine's engine directly, with
  the owner secret in the page (`client/web/src/main.tsx:34`,
  `client/desktop/src/engine.ts:86-95`). It reaches another machine through
  ssh tunnels and a follower process that Electron main keeps
  (`client/desktop/src/hosts.ts`, 2,226 lines). A browser or a phone can do
  neither: without Electron the page stops at "Open Banda from its desktop
  app" (`main.tsx:94-100`).
- **Two away rules.** An act to an away arc is refused at once; an act to
  this machine's restarting engine waits in silence and lands later by
  itself (`client/desktop/src/bytes.ts:36-40`: "This machine is never
  away"). A frozen local engine is never noticed.
- **48 places** in the client tell this machine from another. 36 of them
  are work things that should act the same; 7 are device things; 5 are by
  design or open.
- **A machine reaches the Person only through the window on that machine**
  (`kernel/src/window.rs:10-12`). On devbox, which has no window, an
  Agent's browser tools answer "Banda's window is not open".
- ADR 0123 put the door, with device keys, pairing, revocation and one
  access rule, before any listener beyond loopback.

## Decision

1. **One road.** Every client (the desktop's window, a browser tab, the
   phone, the CLI with `--host`) reaches every engine by one protocol at
   that engine's **door**, and proves a **device key**. The engine proves
   its **host key** on the same connection, so no pipe can pose as arc. The
   window on this machine is a client like any other, on loopback.
2. **The loopback API stays for programs on the machine.** The CLI without
   `--host`, `banda mcp` and Harnesses' shells keep the owner secret and
   Agents' passes there. No network path reaches it, and the door has no
   owner branch and no fallback to passes (ADR 0123, decision 1).
3. **The handshake.** The door sends a challenge signed by its host key;
   the client answers `hello {protocol: {min, max}, device, nonce, sig}`;
   the door answers `welcome` with today's fields plus its host key, the
   device, the protocol it picked and its Apps with their versions, signed
   over the client's nonce, or `goodbye {unsupported | forbidden |
   revoked}`. After `welcome` the frames are today's. The door speaks with
   a protocol range from its first day.
4. **Routes are pipes.** `loopback` for this machine; `tailnet`, through
   `tailscale serve` to the loopback door, for browsers and the phone until
   Banda Cloud; an ssh tunnel to the door's port for desktops and the CLI
   wherever ssh reaches; later `direct` TLS in the engine and a relay. The
   client keeps an ordered list of routes per machine, tries the next one
   beside a slow first one, and keeps the session across a change of route.
   The machine's label names the route quietly ("via tailnet · 18 ms").
5. **Who holds which key.** The desktop's key is held by Electron main, in
   a 0600 file in the app's state until the app is signed (ADR 0121), and
   the page asks main to sign the challenge. A browser's key is WebCrypto,
   not extractable, in the serving origin's storage. The CLI with `--host`
   has a key file of its own.
6. **Pairing.** The desktop pairs itself with its own machine's engine with
   no question: main is that machine's console (ADR 0083, decision 6), and
   it pairs again whenever its own door refuses it. A desktop pairs with
   another machine by its ssh login, which gives what the login already
   gives. A browser or a phone pairs with a code the Person allows from a
   paired device, once for every machine. Removing a device cuts it at once.
7. **ssh keeps** installing Banda, starting an engine once, pairing a
   desktop by its login, and the tunnel as a fallback pipe. It **loses**
   the follower, the owner secret of other machines on the Mac and in every
   page, and the judgement of whether a machine is there.
8. **Machines are joined in `client/core`,** shared by the desktop, the web
   and the phone, not in Electron main. This machine is one entry in the
   list, with the route `loopback`.
9. **One away rule for every machine, this one included.** Every client
   pings every engine on the same clock, loopback too. An away machine is
   said in one word, its rows dim "as of" a time, an act to it is refused in
   words, and a message offers "Send when back". The window stays for every
   stop of its own engine but Quit Banda (ADR 0086, decision 3).
10. **Machine and device.** The machine is where the work runs and its state
    lives; the device is where the Person sits. A machine reaches the Person
    by the device road, to a named device or to wherever the Person is,
    never through "the window on my machine". Devices register their
    presence, capabilities and push with every machine they reach. The
    Agents' browser and the decision of whom to tell move onto the machine.
11. **Nothing breaks on the way.** The door ships in engines one release
    before any window needs it. A window keeps today's road to an engine
    with no door, and its label says "arc runs an older Banda · Update arc"
    (ADR 0119). A cleanup removes the old road once every machine runs the
    door.

## Consequences

- **What it amends.**
  - ADR 0123, decision 2 (the routes add the tailnet through
    `tailscale serve`) and decision 4 (the ssh route carries the door, not
    the owner).
  - ADR 0081, decisions 2 to 5 and 8 (pairing, routes, presence, a range).
  - ADR 0082, decisions 11 to 14 and 17 (the handshake, the device road,
    bytes by a device-bound token).
  - ADR 0083, decisions 1, 6 and 8 (the door's identity, the desktop as the
    console).
  - ADR 0089, decisions 3 to 5 and 8 (the device session, the browser
    adapter, the phone's first version).
  - ADR 0105, decisions 3 and 5 (one away rule; the window pings its own
    engine).
  - ADR 0106, law 6 (its counter widens to the Window's own code).
  - Moving a Thread by the engines gets ADR 0125, written with that slice.
- **How it is checked**, on every PR where it applies:
  - no client branch on "this machine or another" for a work thing (ADR
    0106 law 6's counter, widened; it only falls);
  - no owner secret in any page, and no special entry for this machine;
  - the same gestures on a Mac Project and an arc Project give the same
    screen but the machine's name;
  - the window keeps working with its own engine stopped;
  - the phone and devbox pass every try;
  - timings at 40 and 150 ms of latency, and this machine no slower than
    today.
- **The order** is in [the roadmap](../research/2026-11-08-roadmap-in-slices.md),
  story 1, slices SE1 to SE13.
- **Isolating Agents still waits** (ADR 0123). An Agent on a machine can do
  what its Person can there, as today; the door gives it no new way in.

## As built

- **The handshake (SE3, PRs 1 to 3).** The door's `challenge` also says
  the protocols the engine speaks, so a client that speaks none of them
  knows which side is the older. One protocol number names the frames at
  the API and at the door; the door takes a range of it. The `welcome`
  carries what the two ends proved as one field, `door`: the host key, the
  device, and the host key's signature over the client's nonce. Keys,
  nonces and signatures are base64url, and what is signed is text, one
  field a line (`kernel/src/devices.rs`, `sdk/contract/src/door.ts`).
- **A `goodbye` is not signed yet** (#1660). A client ends the connection
  on one and does nothing else about it. Before a window forgets a key or
  pairs again on `revoked` or `forbidden` (PR 4b), the door signs its
  `goodbye` over the client's nonce.
- **A removed device keeps its record,** marked, so only that device is
  told `revoked`; whoever only knows its ID is told `forbidden`, as a
  stranger is.
- **The door's port** is 22632 for Banda and 22633 for Banda Dev, the one
  its last run had when that is taken, else any, and any for a build from
  a checkout. `engine.json` and `banda status` say it. Naming it in
  `machine.toml` comes when a route first needs it chosen (SE5), as a new
  key there shows in Settings.
- **The API refuses what a proxy carried** by `Forwarded`, `X-Forwarded-*`
  and `Tailscale-*`, and by a `Host` that is not this machine's loopback.
- **What a client follows and hears goes with its `hello`,** at the API
  and at the door, before the `welcome`: nothing that acts does.

