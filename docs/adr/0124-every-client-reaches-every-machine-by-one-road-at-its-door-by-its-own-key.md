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
- **A `goodbye` is signed too** (#1660): once the door read a `hello`, by
  the host key over that `hello` as the door heard it (its own nonce, the
  origin, the device, the client's nonce, the protocols and the `hello`'s
  signature) and the reason, to the `hello` itself and as the session
  ends. A client marks such a refusal as the machine's own word
  (`signed`) only when it is signed to the `hello` the client itself
  said; one a pipe on the way can say, or get by changing the `hello`,
  only ends the connection. A device forgets a key or pairs again on the
  signed one alone.
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
- **This machine is one of the machines in the core (SE3, PR 3).** It
  has an entry as each host has (`KeptHosts.shown`), judged by its own
  engine's connection, as no one else says whether that machine is in
  reach. A client makes such an engine with `staleOnLoss`: once heard, a
  connection that ends, and is not heard again within 3 s, leaves it
  answering nothing until it is heard again, and it tries again all the
  while. Back sooner, as after a blip or a quick restart, it was never
  out of reach, and a command cut off goes again. Then the one rule holds for it
  as for arc: an act is refused at once, in words that name no machine
  ("Banda is restarting on this machine"), a message waits for it, and a
  Pane closed meanwhile is let go of once it is back. A window that
  starts is in reach of its own machine, so what it asks first waits for
  the first connection.
- **The window shows it (SE3, PR 4a).** It makes its own engine with
  that rule and a ping (`ownEngine`). While the engine is out of reach,
  each Pane of this machine has the pill another machine's has, Send is
  "Send when back", and a message that waits says "Waits for Banda on
  this machine". The bar no longer says "Reconnecting…": the pill does.
  A Pane reads its machine through one hook (`useMachineOf`), whichever
  machine that is.
- **The window is at the door (SE3, PR 4b).** Main pairs the window
  with its own machine each time the engine starts, through its own
  client on the loopback API, as that machine's console: `devices.add`
  with `here`, by this device's key, which makes no second record and
  pairs anew after a lost key or a lost device store. The key is an
  Ed25519 key in `device.key` in Banda's state, for its owner alone. The
  page is handed the door's address, the device and the host key, and
  main signs its `hello` to that door, from Banda's own origin, and
  nothing else. An engine whose first line names no door, or a pairing
  that does not answer in 10 s, leaves the page on the owner's secret, as
  before. Main's own client and the bytes it relays stay on the loopback
  API. A page served for development, of another origin, is reached as
  before too. Not yet: a window whose device is removed while it runs
  pairs again only at its next start, or its engine's; and a pairing the
  engine refuses falls back to the secret, where it could remove what is
  in its way and pair again.
- **The door serves the window's page (SE5, PR 1).** A browser that
  asks the door for a page gets the same page Banda's app shows; `curl`
  still gets the machine's one line. The files are the page's build,
  `web/dist` beside the engine's program, where a packed app has it for
  its own window, or `client/web/dist` in a checkout
  (`engine/src/page.rs`). Each answer says what the page may load: its
  own files and its own door, no script written into it, nothing that
  frames it. A file is read from that folder only. The API's port serves
  no page. The page alone is nobody: what it does, it does as a paired
  device on the door's WebSocket. Not yet: the engine's own copy and its
  tarball do not carry the page, so only an engine run from the app or a
  checkout has one; and without the desktop the page said it needed
  Banda's app, until PR 2.
- **A device asks at the door, and the Person allows it by its code
  (SE5).** In place of `hello`, a device this machine has not paired
  says `ask`: its public key, the name the Person reads it by and its
  kind, signed by that key over the door's nonce, the host key and the
  origin, so no one asks in another's name. It is the door's one frame
  that needs no pairing. The door answers `asked` with a code, eight
  letters as `4F7K-92QD`, made from the key and the door's nonce, and
  keeps the connection. The engine keeps the askings in memory: eight at
  most, one per key, each under a code of its own, for five minutes, and
  forgets one whose device left the door. `devices.asking` says them to
  every session that is the Person here, `devices.allow` pairs the one
  with a code, from the origin it asked from, and `devices.refuse` sends
  it away; at the machine's console, `banda devices allow <code>` and
  `refuse <code>`, the code read as it is typed. The device hears
  `paired`, signed by the host key, and comes in again with `hello`; or
  `goodbye`, as it is refused or its time is out.
  - **What the code is for.** It ties the Person's Allow to the device
    they look at, against a mistaken Allow. It is no guard against
    someone between the device and the door: the route's own secrecy is
    (TLS on the tailnet, loopback), and a device trusts the host key its
    first challenge says, on first use.
  - **Any page that reaches the door may ask**, by any name: a site
    open in a browser on this machine reaches the loopback door, and so
    does one on any device of the tailnet. So what asks is said to the
    Person with **the origin it asks from**, which `devices.asking`
    carries, beside its name and code, and the card that offers Allow
    must show it. Such a page may also hold all eight places for as long
    as it stays; the console's `banda devices add` is the way round, and
    a limit on how often one may ask is not built.
  - The contract's client asks with `askAtDoor`
    (`sdk/contract/src/door.ts`): it checks the challenge is signed by
    the host key it names, says `ask`, and tells its caller how the
    asking stands: `asked` with the code, then `paired` with the device
    and that host key, once the door's `paired` is proved by it, or
    `refused`, or `lost`. The key signs through a function, so a
    browser's stays where WebCrypto keeps it.
  - Not yet: the windows' card that offers Allow, which follows the
    mocks.
- **A browser pairs at the door that served it, and is the window
  (SE5, PR 2).** With no desktop behind it, the page is a device of its
  own (`client/web/src/boot/browser.ts`): an Ed25519 key WebCrypto makes
  and does not hand out, kept in the browser's IndexedDB with the device
  it is and the host key it paired with. Not paired, it shows one card
  (`client/web/src/door/`): the machine's name, as the door's one line says
  it, the code, what to do, and the name it asks under, "Safari on
  macOS", which the Person may change, a new name being a new asking
  with a new code. Allowed, the page is the window on that machine's
  engine, as that device; opened again, it comes in with no code. A
  `goodbye` the host key signed, `revoked` or `forbidden`, makes it
  forget the pairing and ask again, under the same key. Not yet: the
  other machines, which a browser will reach by their host keys once the
  window that allows it allows it on them too; the look, which a browser
  takes from the system's light or dark alone; and the settings, which
  only the desktop writes.
- **A window asks the Person about a device that asks (SE5, PR 3a).**
  Every window that is the Person hears `devices.asking` on this machine
  and on each other it reaches, and asks over itself
  (`client/web/src/devices/`): the device's name, the code, its kind,
  when it asked and the address of the page that asks, as any page that
  reaches the door may ask. Allow lets it in on every machine the window
  reaches, or only where it asked: allowed there by its code, it is
  paired on the others by the key that machine says it proved
  (`devices.add`), and one that did not pair it is named. Don't allow
  sends it away. Closed with no answer, it waits out its time, and that
  window says no more of it. Focus starts on neither button.
- **Settings → Devices lists and removes them (SE5, PR 3b).** The section
  shows the devices of the machine picked under "Settings for", as that
  machine keeps them: its name, kind, when it was added and the address
  its page came from. A machine's own window has no Remove, as it pairs
  itself again. Remove cuts a device from every machine the window
  reaches, or only from that one: on each other it is found by its key,
  as each machine keeps it under an ID of its own, and a machine that did
  not answer is named. Nothing there adds a device: one joins by asking
  at a door. Not yet: which row is the device the Person sits at, and a
  browser reaching the other machines by their host keys.
- **A machine says where its door is served (SE5, PR 4a).** Only the
  machine itself knows the name `tailscale serve` hands to its door, so
  its engine asks the host's `tailscale` (`serve status --json`) and
  `devices.list` says each address whose root goes to the door's port, as
  `doors` (`platform/devices/engine/src/served.rs`). None where Tailscale
  is not there, does not answer in three seconds, or serves no door. A
  window that lets a device in on every machine will hand these on. This
  is the one program the devices module starts on the host.
- **The window hands a device the machines it joined (SE5, PR 4b).**
  A machine never vouches for another, so the window that lets a device
  in does: after Allow on every machine it asks each machine it joined
  for its host key and its door (`devices.list`), and hands each the
  others, with the device it is there (`devices.hand`, kept in the
  device's record as `machines`). A machine that serves its door nowhere
  is handed to none. The page a machine serves may then connect to those
  doors besides its own: its policy's `connect-src` names each, `wss://`
  and `https://`, a host a window handed and never a pattern, and only
  an `https` address with no path is taken. Not yet: the browser reading
  them.
- **The window stays for every stop but Quit Banda (SE3, PR 4a).**
  `banda stop`, which Quit Banda runs, says it asked before it stops the
  engine (a `quit` file in the state, which the next run takes away). The
  window's `banda start --with-parent` ends with 0 only then, and the
  window quits. Stopped as asked by anything else, as its unit stopped by
  hand, it ends with 3: the window stays, refuses the page its engine's
  address in the words "Banda is stopped on this machine", and the pill on
  each Pane of this machine says them, with Start, which starts the
  engine again. An engine that crashed is started again, as before.

