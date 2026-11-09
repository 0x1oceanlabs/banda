---
status: proposed
date: 2026-11-09
---

# A machine stays awake while its Agents work, and says its battery

_It amends ADR 0086 (decision 1: what the engine does for its machine)
and ADR 0095 (decisions 1, 2 and 9: a machine's facts, its
`machine.toml` and Settings → Machines). Code is cited from main at
`c964b75e`._

On 2026-11-09, after a live test of arc (Linux) with his Mac, m1pro (a
MacBookPro18,3), Roma asked to keep the Mac from sleeping, or to wake
it, and to see its battery from arc.

On the Mac, on battery: it idle-sleeps after one minute (`pmset -g`:
`sleep 1`), held off only by Claude.app's own assertion; `womp 0`; its
Wi-Fi uses a private address.

He decided (2026-11-09):

1. A machine does not idle-sleep while its Agents work, on every OS:
   the engine holds macOS's `PreventUserIdleSystemSleep` (as
   `caffeinate -i`), logind's `idle` and `sleep` locks, and Windows'
   `ES_SYSTEM_REQUIRED`, later with Windows. The display still sleeps as
   usual. On by default.
2. A setting, "Stay awake while plugged in", off by default: while it
   is on and the machine is on power, it never idle-sleeps, so another
   machine can reach it.
3. Closing a MacBook's lid still sleeps it. Banda says so, does not
   fight it, and never changes the system's power settings.
4. Nothing wakes a sleeping machine from another, for now.
5. A machine with a battery says its charge, whether it charges, and
   the time left. Another machine's window shows it, in Settings →
   Machines and in the machine's hover, and warns once when it runs low
   while Agents work there: "m1pro: 12%, on battery". A machine with no
   battery says nothing.
6. It comes after H5a and before ADR 0086's step 7d: a short ADR, a
   mock for him, then two small PRs, keep awake and the battery.

**Where it stands.**

- Nothing in Banda holds a machine awake: no power assertion, no
  inhibitor lock, no `powerSaveBlocker`. The desktop uses `powerMonitor`
  for shutdown and resume only (`client/desktop/src/main.ts:662`,
  `client/desktop/src/update.ts:351`). On arc, `systemd-inhibit --list`
  shows only the window's own delay lock, "Application cleanup before
  suspend".
- No signal in the engine says that Agents work. `banda stop` counts
  Threads whose latest turn runs, as a client, over every Project
  (`engine/src/control.rs:506-530`); the window counts its lists
  (`client/web/src/calls/stores.ts:246-258`).
- The agents module has one `Live` for all its Projects
  (`apps/agents/engine/src/live.rs:43-60`, built once in
  `engine/src/apps.rs:80-85`). A running turn is a `TurnRun`, from
  `Live::open` until it drops (`live.rs:262-267`, `:338`, `:399-409`).
  A turn that waits on the Person's Question keeps its `TurnRun`.
- The agents App does not depend on `banda-machines`
  (`apps/agents/engine/Cargo.toml:14-16`). `HostContext` hands its parts
  the `Machine` (`engine/src/apps.rs:41-56`).
- `machine.toml` holds `name`, `icon` and `start-at-login`
  (`platform/machines/engine/machine.toml`, `src/file.rs:24-38`). The
  engine follows `start-at-login` through a `watch`
  (`platform/machines/engine/src/lib.rs:81-86`,
  `engine/src/serve.rs:174-182`). Every key in it is the Person's alone
  (`platform/settings/src/person.rs:73`). Settings → Machines draws its
  own Body and none of the file's schema rows
  (`client/web/src/settings/sections.ts:116-126`, `:237-250`).
- Of a battery, the engine knows only that one is there, to pick the
  `laptop` icon (`platform/machines/engine/src/found.rs:42-43`): sysfs
  on Linux, `pmset -g batt` on macOS, WinRT on Windows. arc has one too,
  and UPower.
- arc never idle-sleeps: Omarchy's shell runs a screensaver at 150 s and
  a lock at 300 s, and no suspend. Its lid sleeps it on battery only
  (`HandleLidSwitchExternalPower=ignore`, Omarchy's).
- Another machine's facts reach a window through the Welcome's `named`
  and the `machine.named` stream, a stream of the machine's that names
  no Project (`kernel/src/kernel.rs:614-637`). `KeptHosts` follows it
  for each machine into `Shown.named` (`client/core/src/hosts.ts:245-289`).
- The sidebar's label of a machine has no hover yet
  (`client/web/src/sidebar/Sidebar.tsx:927-929`). ADR 0095, decision 1,
  put its longer facts in one.
- The workspace forbids unsafe code (`Cargo.toml:127`). `platform/fence`
  denies it in its own `[lints]` instead, and allows it item by item.

The mock is in Roma's `~/Banda/artifacts/machines/`:
`battery-mock.html`, with `battery-mock-1.png` (Settings → Machines),
`battery-mock-2.png` (the machine's hover) and `battery-mock-3.png` (the
warning).

## Decision

1. **The engine keeps its machine from idle sleep while any Agent's Turn
   runs** (Roma, decision 1).
   - It holds from the first Turn that starts, in any Project, until 10
     minutes after the last one ends, so the Person's next message, sent
     from another machine, finds it awake (open, below). A Turn that
     waits on the Person's Question still runs, so the machine waits
     with it.
   - Only idle sleep. The display dims and sleeps as usual, and the
     Person's own Sleep, the lid and a low battery still sleep it
     (decision 4).
   - On by default: `awake-while-working = true` in `machine.toml`.

2. **"Stay awake while plugged in", off by default** (Roma, decision 2).
   - `awake-plugged-in = false` in `machine.toml`. While it is on and the
     machine is on power, the engine holds it awake always, Agents or
     none, so other machines reach it. A machine with no battery is
     always on power.
   - It is a host's setting (ADR 0081, decision 12), the Person's alone,
     as all of `machine.toml` is: an Agent cannot turn it on.
   - Settings → Machines draws both keys under This machine, and "Stay
     awake while plugged in" in each other machine's row, written through
     that machine's engine as its name is (ADR 0095, decision 9), and off
     while it is away (open, below).

3. **One hold, in the engine, by each OS's own means** (Roma, decision
   1).
   - The engine takes one hold while `working > 0` (with its tail) or
     `awake-plugged-in && on power`, and looks again when either
     changes. It is named "Banda" and says why: "Agents work" or
     "Plugged in".
   - **macOS**: one IOKit power assertion of type
     `PreventUserIdleSystemSleep`, as `caffeinate -i` makes. Any process
     may hold one, from launchd or ssh, with no entitlement. It shows in
     `pmset -g assertions` and in Activity Monitor's "Preventing Sleep".
   - **Linux**: logind's `Inhibit` on the system bus, for `idle` and
     `sleep`, as `systemd-inhibit --what=idle:sleep` takes them.
     - `idle`, in `block` mode, is the lock that holds idle sleep:
       logind's own `IdleAction`, and an idle daemon that reads it, as
       hypridle does, wait while it is held.
     - `sleep` is in `block-weak` mode, so the Person's own Suspend still
       goes through, and so does their idle daemon's if it does not read
       `idle`; another user's suspend does not. Since systemd 257,
       `block` refuses the Person too. An older systemd has no
       `block-weak`, and its `block` already lets the Person through.
     - The lock is a file descriptor, marked close-on-exec as it comes,
       so a Harness or Terminal started meanwhile does not keep it.
     - logind's policy grants both to the Person's engine with no prompt
       (tried on arc, systemd 262, from a user service). Outside any
       session, `sleep` needs an admin, so an engine that lingers with
       nobody logged in may get only `idle`: it logs that once and keeps
       what it got. It never asks for interactive authorization, so no
       password prompt shows.
   - **Windows**, with ADR 0090:
     `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`, held
     by one thread the engine keeps for it.
   - Each OS lets the hold go when the engine exits or crashes.
   - The agents module counts its running Turns through a small counted
     guard of the kernel's, held by each `TurnRun`; the engine wires its
     count to the hold in `serve.rs`, beside `follow_login`. The OS
     calls that need unsafe code sit in one function each, allowed by
     name, with the machines crate's `[lints]` as `platform/fence` has
     them.

4. **Banda never fights the lid, and never changes the system's power
   settings** (Roma, decision 3).
   - Closing a MacBook's lid sleeps it, whatever any app holds; only
     clamshell, with power and a display, keeps it awake. On Linux,
     logind's `HandleLidSwitch` settings decide, and their default
     `LidSwitchIgnoreInhibited=yes` passes over Banda's locks; Banda
     takes no lid lock.
   - Banda does not run `pmset`, edit `logind.conf` or change a power
     plan.
   - It says so under the switches of a machine with a battery, and in
     `docs/hosts.md`: on a Mac, that a closed lid still sleeps it; on
     Linux and Windows, that a closed lid does what the system's own
     settings say; and that Banda does not change them. A machine that
     sleeps shows away on the others, as now.

5. **Nothing wakes a sleeping machine, for now** (Roma, decision 4).
   Wake-on-LAN is unreliable over a MacBook's Wi-Fi (a private address,
   the battery), and does not cross Tailscale. It is an issue, for
   later.

6. **A machine with a battery says it, in `machine.power`.**
   - A stream of the machine's, as `machine.named` is, sent as it opens
     and again when a word of it would change: `{ battery?, awake }`, with
     `battery` as `{ percent, charging, on_power, left? }` (`left` in
     minutes: to empty on battery, to full while charging), and `awake`
     as `"working"`, `"plugged-in"` or none.
   - No battery, no `battery`: a desktop or a server says nothing of it.
   - **macOS**: `pmset -g batt`, which `found.rs` already runs: its
     percent, its state, and its `H:MM remaining`. "AC attached; not
     charging", as Optimized Battery Charging holds it at 80%, is on
     power and not charging.
   - **Linux**: UPower's display device on the system bus (`Percentage`,
     `State`, `TimeToEmpty`, `TimeToFull`, and `OnBattery`, which
     signals a change), else sysfs, with no time left.
   - **Windows**, with ADR 0090: WinRT's `PowerManager`, as `found.rs`
     already asks WinRT.
   - The engine reads the power source each 30 s for decision 2, and the
     battery each minute while a window follows the stream.
   - An engine older than this refuses the stream; the window then shows
     no battery for it, as it shows no name.

7. **Another machine's window shows it** (Roma, decision 5).
   - Its words: "42% · on battery · 2:02 left", "67% · charging · 0:48
     to full", "80% · on power". A time the OS does not know yet is left
     out.
   - **Settings → Machines**: the row's header gives the percent beside
     the state, and the open row a Battery line in full, with why the
     machine is awake now: "Kept awake: 2 Agents work there".
   - **The machine's hover**: a card on its sidebar label, and on its
     mark on a row, with the longer facts ADR 0095 put there, the
     battery, and why it is awake.
   - Away, nothing: the last battery heard is no longer true.
   - This machine's own battery is the system's to show, not Banda's.

8. **It warns once when the battery runs low while Agents work there.**
   - When another machine is on battery at 20% or less (open, below),
     and its Agents work: one toast, "m1pro: 12%, on battery", "2 Agents
     work there. Plug it in, or it sleeps as the battery runs out."
   - Once per discharge: it warns again only after the machine was on
     power.
   - The window works it out, keyed by the machine, from `machine.power`
     and its lists, as `tellWoke` does (`client/web/src/calls/woke.ts`).
     Calls move to the host later (ADR 0081, decision 6), and this with
     them. This ADR is the agreement ADR 0048, decision 4, asks of a new
     teller.

## What it amends

- **ADR 0086, decision 1**: the engine also keeps its machine awake for
  its Agents. Plan step 7d's `banda status --follow` comes after this,
  and can carry `machine.power` for the menu bar.
- **ADR 0095, decision 1**: the hover of a machine's longer facts adds
  the battery. **Decision 2**: `machine.toml` gains two keys.
  **Decision 9**: Settings → Machines draws them, and the battery.
- **ADR 0090**, still a draft: its Windows calls are named here.

## Plan

It comes after H5a, H5's first part
(`docs/research/2026-11-08-roadmap-in-slices.md`: Send and the pill say
the same of another machine, and away shows sooner), and before ADR
0086's step 7d. Each step is its own PR.

0. This ADR, and the mock for Roma.
1. **Keep awake.**
   - The engine: the two keys in `machine.toml`, `file.rs`, its schema
     and the generated contract; the hold,
     `platform/machines/engine/src/awake.rs`, with macOS and Linux behind
     it; the on-power read; the kernel's counted guard, held by
     `TurnRun`; `engine/src/serve.rs` wires them.
     Tests: the rule as a pure function, the file's keys, and the fake
     Harness's "wait" holding the count.
   - The window: the two switches and the lid line under This machine,
     and "Stay awake while plugged in" in another machine's row, in
     `client/web/src/settings/MachinesSettings.tsx`. Its file list is
     agreed with the window's session first.
   - `docs/hosts.md`: what keeps a Mac awake, and the lid.
   - To try: m1pro on battery, left alone, with nothing else holding it
     (Claude.app quit; `pmset -g` names no other). From arc, a Turn there
     of a few minutes: m1pro stays live through it and for 10 minutes
     after, then shows away; `pmset -g assertions`, over ssh, names
     Banda during it. With "Stay awake while plugged in" on and m1pro on
     power, it stays live with no Turn. On arc, `systemd-inhibit --list`
     shows Banda's lock during a Turn and none 10 minutes after, with a
     Terminal started in it still open.
2. **The battery.**
   - The engine: `platform/machines/engine/src/power.rs` (macOS `pmset`,
     Linux UPower and sysfs), the `machine.power` stream in
     `kernel/src/kernel.rs` beside `machine.named`, and its type in
     `sdk/contract`.
   - The window: `Shown.power` in `client/core/src/hosts.ts`, followed as
     `#named` is; the row and the Battery line in `MachinesSettings.tsx`;
     the hover card in `client/web/src/sidebar/Sidebar.tsx` and `Row.tsx`;
     the warning in `client/web/src/calls/battery.ts`.
   - To try: from arc, m1pro's percent falls in Settings and in the
     hover while it is on battery; with it at 20% or less, a Turn there
     gives one toast, and none again until it was on power.

## Later

Each is an issue:

- Waking a sleeping machine (decision 5).
- GNOME may not read logind's `idle` lock, but its own session's
  `Inhibit`: tried on a GNOME machine.
- On a desktop whose idle daemon reads logind's `idle` lock for the
  screen too, as hypridle does, the screen stays on while Agents work.
  Omarchy's shell on arc does not read it.
- `banda stop` and Quit read the engine's count of running Turns, not
  their lists (ADR 0086, decision 3).
- `banda status` says the battery too.

## Open

These are this ADR's, not Roma's; the mock puts them to him.

- **The 10-minute tail** (decision 1). Without one, m1pro on battery
  sleeps a minute after a Turn ends, before the Person answers from arc.
  Ten minutes is a guess.
- **A switch for "while Agents work"** (decision 2). Roma named one
  setting. "On by default" means it can be off, so it has a key; the
  mock gives it a switch under This machine only.
- **20%** (decision 8). Roma's example says 12%. At 20% the toast comes
  with time left to plug in.
- **A toast only** (decision 8): no sound, no system notification. The
  bell keeps it (ADR 0048, decision 2), but a window behind others may
  miss it.
