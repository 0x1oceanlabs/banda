# The roadmap in slices

Plan, 2026-11-08, agreed with Roma the same day. It orders the work of the vision (`2026-11-06-architecture-vision.md`, §9.3 and §10) as slices the Person can try. The IDs are the vision's.

## How we build

- **A slice every one or two days.** Each one ends in a Dev build and a "What to try" list on two machines: arc (Arch, always on) and a Mac (the client Roma works from). A step that would take longer is split.
- **Each slice is built in the end shape**: actions, not props; hooks over the hosts store; the seams H5 fills, such as `KeptHosts.sessionOf`. The refactor then moves code instead of rewriting it.
- **Foundation only when a slice needs it.** The slice names the vision item it pulls in, as T-pred pulled A8 and seen on the host pulled E8 (ADR 0096).
- **One short ADR per stage, with a mockup**, and Roma's decisions gathered in one list rather than asked one by one.
- **Two tracks at once, no more.** One builds hosts and the engine. The other builds the window: ADR 0087, then `client/core` (ADR 0089), then the look (ADR 0080).
- **Frozen until a stage needs them:** Windows, ADR 0092's later steps, CI work, iroh, Apps from elsewhere, Banda Cloud.

## Where we are

- **Done:** the engine as the machine's service on Linux (M1: S1, S3, ADR 0086 step 3); the stopgap, the browser wall, the Project's trust flag and the start of the fence (M2: ADR 0083 steps 1 and 2, steps 3 and 4 in part); receipts, retries and leases, the authorizer, durable cursors, the environment port and the router's order (M3: A3 to A8).
- **Under way:** seen and archive on the Thread's host (E8 as ADR 0096); the window's split (B4, T-pred, ADRs 0087 to 0089).
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

### 3. The fence, finished, then pairing

The rest of F0 and B14, one access rule (ADR 0083 plan steps 4 and 5). Little of it shows, so it goes in few PRs with one check at the end. Then the slice that shows: a second device joins with a code instead of ssh (H3, ADR 0081 step 2).

It comes before the phone because no listener leaves loopback before the fence (vision, H4).

### 4. The web and the phone (M8)

Banda in Safari on the Mac over a tailnet: the page without Electron, served by the host over `direct` TLS (H4, W1, W2). Then the phone as a PWA: the Threads list, the Inbox, reply, Stop (W3, ADR 0089 W4). Then pushes with no window open (E9). It stands on `client/core`, which the window track builds, so nothing is done twice.

### 5. After

The look (M7, ADR 0080) may run beside stage 4 on the window track. Then the SDK (M10 to M12: views, the tracer App, MCP Apps), isolated Projects (M13), and Banda Cloud last (M14).

## Rework we know of

These are moves, not rewrites:

- The `ssh` route lives in Electron main today. When H4 brings the transport port, it becomes one of its routes. A browser cannot run ssh, so the phone needs `direct` TLS as a second route, beside it.
- The Mac's engine is the window's child until ADR 0086 step 7.
- The hosts router moves from `client/web` to `client/core` at W0, by `git mv`.

## Risks

- **Too many tracks.** Kept to two.
- **Roma's decisions are the scarcest input.** One ADR and one mockup per stage, and the decisions in one list.
- **A home host that sleeps.** arc is always on; H5's fail-fast covers the rest (vision §4.6).
