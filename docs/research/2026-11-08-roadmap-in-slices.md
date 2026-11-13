# The roadmap in slices

Plan, 2026-11-08, agreed with Roma the same day. It orders the work of the vision (`2026-11-06-architecture-vision.md`, §9.3 and §10) as slices the Person can try. The IDs are the vision's.

_Amended 2026-11-12 and 2026-11-13: stages 3 to 5 are replaced by the order of [what we build](../what-we-build.md): story 1, one Banda on every machine, as the foundation; story 2, an Agent writes an App, as the difference; then the other stories. The fence splits: the door comes with story 1 and isolating Agents waits ([ADR 0123](../adr/0123-the-door-comes-with-the-session-that-follows-the-person-and-isolating-agents-waits.md))._

## How we build

- **A slice every one or two days.** Each one ends in a Dev build and a "What to try" list on two machines: arc (Arch, always on) and a Mac (the client Roma works from). A step that would take longer is split.
- **Each slice is built in the end shape**: actions, not props; hooks over the hosts store; the seams H5 fills, such as `KeptHosts.sessionOf`. The refactor then moves code instead of rewriting it.
- **Foundation only when a slice needs it.** The slice names the vision item it pulls in, as T-pred pulled A8 and seen on the host pulled E8 (ADR 0096).
- **One short ADR per stage, with a mockup**, and Roma's decisions gathered in one list rather than asked one by one.
- **Three tracks at once, no more** (Roma, 2026-11-13; two before). One builds story 1: hosts, the engine and the one road. One builds story 2: an App an Agent writes. One builds the window: ADR 0087, then `client/core` (ADR 0089), then the look (ADR 0080). Joining the machines in `client/core` (SE3, SE4) is story 1's, so the window track leaves `client/core/src/hosts.ts` and `client/desktop/src/hosts.ts` to it.
- **Frozen until a stage needs them:** Windows, ADR 0092's later steps, CI work, iroh, Banda Cloud, isolating Agents (ADR 0123). Apps from elsewhere come back with story 2.

## Where we are

- **Done:** the engine as the machine's service on Linux (M1: S1, S3, ADR 0086 step 3); the stopgap, the browser wall, the Project's trust flag and the start of the fence (M2: ADR 0083 steps 1 and 2, steps 3 and 4 in part); receipts, retries and leases, the authorizer, durable cursors, the environment port and the router's order (M3: A3 to A8).
- **Under way:** seen and archive on the Thread's host (E8 as ADR 0096); the window's split (B4, T-pred, ADRs 0087 to 0089).
- **2026-11-12:** stage 1, two machines, is done (2026-11-11). Stage 2, remote Panes, is done but for #1324 and the draft ADR 0120 (#1578).
- **Pulled ahead, by Roma's choice:** several machines in one window over `ssh` (M9, ADR 0081 step 5 as amended). It opens no listener beyond loopback, so it does not wait for the fence.

## Stages

### 1. Two machines, finished

| Slice | What the Person tries | Pulls in |
|---|---|---|
| Seen and archive follow the host | read a Thread on the Mac and it is read on arc | E8 (ADR 0096 step 2b) |
| The composer names the machine | "Write to … on arc"; no send into nowhere while arc is away | ADR 0095 step 4b |
| Settings → Machines | rename arc from the Mac, change its icon, test, stop, add, remove | ADR 0095 step 5 |
| A new Thread on arc from the Mac | the New Thread picker offers arc's Projects | ADR 0095 step 4c |
| Honest when away | at once "arc is away", and what waits to be sent is shown | H5, after W0 |
| The Mac's engine as a service | close Banda's window on the Mac and arc still reaches its Agents | ADR 0086 step 7 (launchd, the menu bar), mockup first |

### 2. Remote Panes (M5)

A short ADR first. Then, one slice each: arc's terminal on the Mac; arc's Files, Git and Diff; images, links and Run in an arc Agent's replies (E1); arc's settings and look from the Mac (E4, E5). arc's browser comes later, with port forwarding.

This comes before the web because it is the same contract the web needs: the screen here, the data on the host. Built for the Mac, most of the web's work is done.

### 3. Story 1: one Banda on every machine

The foundation (Roma, 2026-11-13): every machine looks and acts the same from the desktop, the web and the phone, as `ssh` lands you in the same terminal (principle 9). Every client reaches every machine by one road (ADR 0124). Moving a Thread comes at the end. Track A, about 47 days of work.

| Slice | What Roma tries |
|---|---|
| SE0 the docs | this PR: principle 9, story 1, ADR 0124 |
| SE2 devbox starts at boot | reboot devbox, unlock: its engine runs with no window anywhere |
| SE1 the gates | another machine's cards and Projects have the same menus as this one's (Rename, Fork, Stop, pin, trust) |
| SE3 the door, and this machine on it | kill the Mac's engine: the window stays, says "away", offers "Send when back", and arc goes on |
| SE5 the window in any browser | Safari pairs with one "Allow" and shows the same window, all three machines |
| SE6 the phone | from the iPhone, answer an Agent's question on devbox and stop a turn on arc; story 1 then runs end to end with today's move |
| SE7 told anywhere | the phone in a pocket gets a push; the Mac and the phone side by side give one signal |
| SE4 every desktop on the road | "via tailnet · 18 ms"; after sleep, arc's Panes are back within a second |
| SE9 the Person's screen reaches every machine | a devbox Agent's Diff and browser tab show on the Mac, then on the phone |
| SE11 the engines carry the move (ADR 0125) | move a working Thread and close the window: after its turn it is there |
| SE12 move from the phone | the whole story with a working Thread |
| SE13 the room goes along | the worktree and the Thread's Panes follow it |
| beside: SE8 feels local, SE10 every machine's Project is whole | echo over the phone's hotspot; ADR 0120's tries |

### 4. Story 2: an Agent writes an App

The difference, on a second track beside story 1 (Roma, 2026-11-13). An App the Person's own Agent writes installs with no click (Roma, 2026-11-12).

| Slice | What Roma tries |
|---|---|
| 2-0 the base: A1a, H1 with #1231 and #1226 | `banda status` lists each machine's Apps and their versions |
| 2a an App from the Agent | on devbox an Agent writes a clients App; another Thread, Claude then Codex, finds clients in Berlin; a broken migration turns off only that App |
| 2b in one Thread, readable without it | it installs with no restart; `banda export --app clients` prints its rows |
| 2c the default screen | a list and a form drawn from its Tree, on arc and in the Mac's window; on the phone after SE6 |

### 5. The other stories

A CRM as an App, an Agent asks an Agent, your Banda from a browser, no server of your own (Banda Cloud), a document for two. The look (M7, ADR 0080) may run beside them on the window track.

## Rework we know of

These are moves, not rewrites:

- The `ssh` route lives in Electron main today. When H4 brings the transport port, it becomes one of its routes. A browser cannot run ssh, so browsers and the phone take the tailnet through `tailscale serve` first, and `direct` TLS later (ADR 0124, decision 4).
- The Mac's engine is the window's child until ADR 0086 step 7.
- The hosts router moves from `client/web` and Electron main to `client/core`, and stays there: machines are joined in `client/core` (ADR 0124, decision 8). Only moving a Thread goes to the engines (ADR 0125, slice SE11).

## Risks

- **Too many tracks.** Kept to three.
- **Roma's decisions are the scarcest input.** One ADR and one mockup per stage, and the decisions in one list.
- **A machine that sleeps.** arc is always on; H5's fail-fast covers the rest (vision §4.6).
