---
status: accepted
date: 2026-11-08
---

# A machine names itself: a name and an icon, and no colour

_It amends ADR 0081, decision 12 (where a machine's name comes from, and
whose file `hosts.toml` is). Code is cited from main at `129c2fe9`._

Roma, on 2026-11-08 (translated): "I want each machine to have a name and
an icon, so it can be told apart at a glance, and maybe a chip, so the
full name need not show. Think through a good UX and UI, and the
settings: how it shows, and in the same place the machines' own
settings."

The mock put three choices to him, each with a recommendation, and he
took all three ("go by your recommendations, I agree"):

- **B1, another machine on a row: b**, its icon and its name in small
  muted text, over the icon alone (a) and a chip on a ground (c).
- **B2, who names a machine: a**, the machine itself, over each window
  naming it (b) and a machine's own name that a window may rename (c).
- **B3, where the Person writes: a**, the Pane's header and the
  composer's placeholder, over a chip in the composer's footer (b).

And no colour for a machine: colour means the account (ADR 0093).

**Where it stands.**

- Another machine is named by its key in `hosts.toml`, the window's own
  for its ssh entry: lowercase letters, digits and `-`
  (`client/desktop/src/hosts.ts:57-68`). Nothing the machine says of
  itself reaches the page, which gets that key and a state
  (`client/web/src/host.ts:83-95`). Two comments state that as a rule:
  the page gets "only the window's own words" (`hosts.ts:24-26`), and a
  state's `why` is "never what the other machine said" (`host.ts:80-81`).
- The desktop's words for a state name the machine by that key too:
  "Banda Dev is not open on m1pro" (`hosts.ts:784`, and `:678`, `:686`,
  `:790-791`, `:801`, `:810-811`). `reachWords` puts the key before a
  refusal's words again (`client/web/src/calls/hosts.ts:313`).
- The sidebar's label over its Projects is that key in text, with no
  icon, and its state in words on the right
  (`client/web/src/sidebar/Sidebar.tsx:934-974`, `HostWords` at `:976`).
  In the Inbox, its rows carry the key in a bordered tag after the
  Project (`client/web/src/sidebar/Row.tsx:166-173`).
- Its rows draw the Harness's own emblem, not the one its account has
  there: `ElsewhereRow` hands `Row` no accounts (`Sidebar.tsx:1108-1117`),
  so `emblemOf` falls back (`Row.tsx:46`, `:183`).
- A Pane of its Project does not name it: the header shows the Thread's
  mark, its Project and its title
  (`client/web/src/tiling/PaneFrame.tsx:376-436`). While it is out of
  reach, a pill says so in `reachWords`' words, with no time and no
  action (`PaneFrame.tsx:474-483`, `client/web/src/calls/hosts.ts:295-315`);
  another kind of Pane says "Not on {key} yet" (`PaneFrame.tsx:450`). The
  Thread Pane knows only `args.host`, not the machine's state
  (`apps/agents/pane/src/ThreadPane.tsx:41`).
- The composer says "Write to {account}."
  (`apps/agents/pane/src/composer/placeholder.ts:14`). A New Thread's
  Project picker lists one engine's Projects
  (`apps/agents/pane/src/composer/NewThread.tsx:31`). A system
  notification reads "{title} · {Project}"
  (`platform/notifications/pane/src/system.ts:40`), a popped window
  "{title} — Banda" (`client/web/src/window/Popped.tsx:54`).
- `hosts.toml` is read once, as main starts (`hosts.ts:432`,
  `client/desktop/src/main.ts:283`): "restart Banda after a change"
  (`docs/hosts.md:35`).
- The engine's Welcome says its protocol, version and modules, the Host
  scope's ID (`machine`, a `ProjectId`, none while no module of the
  machine's runs), its boot and its fence (`kernel/src/api.rs:106-125`),
  and nothing of its name.
- Settings has no section for machines (`client/web/src/settings/sections.ts:99-222`).
- ADR 0081 decision 12 says whose each settings file is: the host's, the
  Person's or a device's
  (`docs/adr/0081-banda-runs-on-several-machines-and-banda-cloud-only-connects-them.md:133-137`).
  `hosts.toml` is in none of its lists.
- `GLOSSARY.md` has **Host** (`:163-168`) and no "machine", though the
  window and `docs/hosts.md` say "machine" to the Person.

The mock is in Roma's `~/Banda/artifacts/machines/`: `machines-v1.html`
(whole in `machines-v1-dark.png` and `machines-v1-light.png`), and its
parts: `clip-intro.png`, `clip-identity.png` (what a machine is),
`clip-projects.png` (the Projects preset), `clip-inbox.png` (B1),
`clip-pane.png` (B3), `clip-else.png` (the bar, the Banda menu, a
notification, a popped window), `clip-settings.png` (B2 and Settings →
Machines) and `clip-notes.png`.

## Decision

1. **A machine is a name and an icon, and no colour.**
   - The name has up to 16 characters. The icon is one of ten, Lucide's,
     drawn in the text's colour, muted, with a line of 2, on no ground:

     | `icon` | Lucide | For |
     |---|---|---|
     | `laptop` | `laptop` | a laptop |
     | `desktop` | `monitor` | a desktop, a Mac mini, an iMac |
     | `tower` | `pc-case` | a tower |
     | `server` | `server` | a server |
     | `database` | `database` | a database's server |
     | `storage` | `hard-drive` | a NAS |
     | `router` | `router` | a router, a Raspberry Pi |
     | `vm` | `monitor-cloud` | a VM, a cloud host |
     | `phone` | `smartphone` | a phone |
     | `tablet` | `tablet` | a tablet |

   - None looks like one of the fifteen account emblems (ADR 0093,
     decision 2), even drawn grey. `square-terminal` is left out: it is
     Codex's `>_`, and a terminal's. So is `server-cog`: at 12 px it reads
     as `local`'s chip.
   - Colour means the account, and a machine's state is said in words; a
     colour for the machine would put two coloured meanings on one row. A
     machine is told from an emblem by its own icons and its place, not by
     colour: Codex's own colour and graphite are grey too.
   - Its **compact form**, on a row: the icon at 12 px and the name in
     `text-xs`. Its **full form**, on a label and a Pane's header: the icon
     at 14 px and the name. The longer facts (hostname, OS, address,
     build) are in its tooltip and in Settings, so a long name need show
     nowhere.

2. **The machine names itself, in its `machine.toml`** (B2 a).
   - It is a host's settings file (ADR 0081, decision 12), in the
     engine's config folder beside `harnesses.toml`:

     ```toml
     name = "arc"     # up to 16 characters
     icon = "server"  # one of the ten
     ```

   - The engine sends them in its Welcome, and again whenever either
     changes, as a piece of `machine.named`: a stream of the machine's
     that names no Project, as `window.requests` does
     (`kernel/src/api.rs:88-99`), so it is there whatever modules run.
     The Welcome's `machine` scope would not do: it is none while no
     module of the machine's runs (`api.rs:111-115`). Every window, on
     the Mac, on arc and later on a phone, shows the same names, and a
     new window has them with no setup.
   - Only the Person changes them: `machine.toml` joins what
     `only_the_person` refuses an Agent
     (`platform/settings/src/person.rs:24`), since a machine named as
     another would pass its Threads off as that one's.
   - **This changes a rule of the window.** Until now the page draws no
     word another machine wrote: main reads what that machine prints over
     ssh and hands the page only its own words
     (`client/desktop/src/hosts.ts:24-26`), and a state's `why` is
     "never what the other machine said" (`client/web/src/host.ts:80-81`).
     A machine's name is the first text a machine writes of itself that
     the page draws. It comes in the Welcome, on the page's own
     connection to that engine, not through main's ssh, so main cannot
     clean it. The page does, in `client/ui`, where it reads the Welcome
     and the stream, before anything draws them: a name is cut at 16
     characters; control characters and format characters (Unicode's Cc
     and Cf: the bidi controls, zero-width spaces and joiners) are
     dropped; a name left empty draws as the key; an icon not of the ten
     draws as `desktop`. The name is drawn as text, never as markup. The
     state's `why` stays the window's own words.
   - A device keeps the last name and icon it saw of each machine, in its
     own state (the view is each device's, ADR 0081 decision 1), so a
     machine away or stopped draws as before. Before a machine's first
     Welcome on this device, it shows as its key in `hosts.toml`, with
     the `desktop` icon.
   - `hosts.toml`'s `name` stays the device's own key for an ssh entry. A
     Pane's `args.host`, the stores and `banda --host` (ADR 0081,
     decision 13) hold it, and Settings never changes it. The Person sees
     it only until that machine's first Welcome.
   - So the desktop's words for a state do not name the machine: "Banda
     Dev is not open there", not "…on m1pro". The page puts the
     machine's name before them where they need one, as `reachWords`
     does.
   - A Test, and Add's Connect, find a machine before any Welcome: its
     name and its system come through main's ssh probe
     (`client/desktop/src/hosts.ts`), and main cleans them with the
     page's rule. The page cleans the name again before it draws it
     (`client/web/src/settings/machines.ts`); #938 makes the two one
     rule.

3. **With no setup, a machine has a name and an icon.**
   - The name is the hostname without `.local`. A hostname a system made
     up gives way to words: `DESKTOP-4F2K9` becomes "Windows PC",
     `ip-10-0-1-5` "Cloud", and a Mac's `Romas-MacBook-Pro`, its owner
     and its model, "MacBook Pro" (as `…s-MacBook-Air`, `…s-Mac-mini`,
     `…s-iMac` give their models).
   - A longer name is cut to 16 at the end of its last word that fits (a
     space, `-` or `.` ends a word), or at 16 when its first word is
     longer.
   - The icon is what the machine is: a VM or a container `vm`; one with
     a battery `laptop`; a Mac mini or an iMac `desktop`; Linux with no
     battery, its engine a service, `server`; any other `desktop`. No
     engine runs on a phone or a tablet, so no default gives `phone` or
     `tablet`.
   - The engine works these out; `machine.toml` holds only what the
     Person or Add changed, as every settings file holds only what was
     set.
   - When Add finds that the new machine has the name of a machine
     already shown, as two VMs both "Cloud" or two PCs both "Windows PC",
     the window numbers the new one, "Cloud 2", and writes that in the
     new machine's `machine.toml`, so every window agrees.
   - When the new machine's icon is `server` and a machine shown has
     `server` already, the window moves the new one on, `server` →
     `tower` → `database`, and writes that there too. Other icons stay as
     they are: two laptops keep one icon, and their names tell them
     apart.

4. **This machine is not named, unless the Person asks.**
   - Its rows and its Panes carry no machine: no name means here. With
     one machine, nothing is named anywhere, and the sidebar is as today.
   - "Name this machine too", off by default, names it as the others are:
     a label over its Projects, its name in its Panes.

5. **On a row, another machine stands after the Project** (B1 b).
   - In its compact form, muted, with no border and no ground, the name
     at most `max-w-16` and cut. It replaces today's bordered tag.
   - A row of one line shows the icon alone, after the Project's sign.
   - A row that hides its `project` part shows the machine in its place:
     where a Thread runs always shows.
   - The order is the same everywhere: the Project, then the machine
     ("banda on arc").
   - The account's emblem stays at the end of the last line, in its
     colour. Another machine's rows draw the emblem its account has
     there, from that machine's accounts.

6. **The Projects preset gives each other machine a label.**
   - This machine's Projects come first, with no label, as now. Each
     other machine follows under a quiet label in its full form, with its
     state in words on the right, as now: "away · 12 min"; "stopped" and
     Start; "other build", with both builds below it, and "Update arc"
     once #775 lands; three quiet dots while it connects; Tailscale's
     sign-in link; a refusal's reason. A Mac where Banda is not open
     (#817) is shown away, tried again each minute and with no Start; it
     reads "away" until #826 gives it words of its own.
   - The rows under a label carry no machine: the label says it.
   - Hovering the label shows ⋯: Fold arc, Machine settings, Stop Banda
     on arc.

7. **Where the Person writes to another machine, it is always named**
   (B3 a). None of this is a setting.
   - A Pane of its Project names it in the header, in the full form,
     after the Project.
   - The composer's placeholder and an empty Thread say "Write to
     Personal on arc".
   - No chip in the composer's footer: beside the account's, it would
     make two chips of an icon and a word that mean different things.
   - While the machine is away, a pill with its icon says "arc is away ·
     2 min". Send is off and the draft stays; Send's tooltip says "arc is
     away. Send once it is back." The other states take the same pill:
     "Banda is stopped on arc · Start", "arc runs another build · Update
     arc".
   - A terminal on arc, once there is one, names the machine after its
     folder. A Pane that does not open there yet says "Not on arc yet"
     under the machine's icon.
   - A New Thread's Project picker groups the Projects by machine, as the
     sidebar does: this machine's with no label, then each other's under
     its label. A Thread started in another machine's Project starts on
     that machine's engine.

8. **Elsewhere, in words where icons do not draw.**
   - The top bar does not change: it is this device's, and its
     Connection is its own engine's. The machines' states are on the
     sidebar's labels.
   - In the Banda menu, a Thread's meta reads "banda ▭ arc · waits", ▭
     being the machine's icon. Typing "arc" finds the machine, in a group
     "Machines" with "Machine settings", and its Threads.
   - A system notification draws no icon: "Bench window tests · banda on
     arc".
   - A popped window's title: "Bench window tests · arc — Banda".

9. **Settings → Machines, after Projects.**
   - Its files: `machine.toml`, this machine's, and `hosts.toml`, this
     device's. Changes apply at once: `hosts.toml` is applied live, and
     the restart `docs/hosts.md` asks for goes.
   - **This machine**: its icon, a button that opens the picker; its name,
     in a field; and a line of facts: model, OS, Banda's build.
   - **Other machines**: a row for each entry of `hosts.toml`, which opens
     in place:
     - Name and icon, with Edit, which writes in that machine's
       `machine.toml` through its engine. While it is away, Edit is off:
       "Rename arc when it is back".
     - Address: the ssh destination (`ssh`).
     - Banda on arc: its path (`banda`); left empty, Banda finds it.
     - Build: "dev.421, same as here".
     - Test connection, Stop Banda on arc, and Remove…, whose
       confirmation says "Its Projects stay on arc."
   - **Add a machine**: the Hosts of `~/.ssh/config` as suggestions, an
     address field and Connect, which finds the machine: "Found devbox:
     Arch Linux · banda dev.421, same build", with its own name and icon,
     and the icon Add moves it to (decision 3). Then Add. The Person
     types no name: the entry's `name` is made from the address.
   - The icon picker greys the icons other machines have, and still
     takes them.
   - **Show**, in `sidebar.toml`, the Person's, so in every window of
     theirs: "Machine on rows: Icon and name / Icon / Off", and "Name this
     machine too".

## The words

- The Person-facing word is **machine**: the sidebar's labels, Settings →
  Machines, "Not on arc yet", "Stop Banda on arc", `docs/hosts.md`. The
  window does not say "host".
- **Host** stays the word of the code and the ADRs for a machine where
  `banda serve` keeps Projects.
- In the code, `machine` already names the Host scope's ID, an older
  name: the Welcome's `machine`, and `useMachine`
  (`client/ui/src/hooks/use-status.ts:35`). So a machine's name and icon
  travel as `named`, `{ name, icon }`, in the Welcome and in the
  `machine.named` stream.
- A machine's name and icon together have no word of their own: "mark"
  is the Thread's, "emblem" the account's, "sign" the Project's. This ADR
  says the compact form and the full form.
- A phone or a tablet is a device (ADR 0081, decision 5), not a host: it
  has no rows. Its icons are for when Banda lists devices.
- `GLOSSARY.md` gains **Machine**, and **Host** says that the Person calls
  it a machine.

## What it amends

- **ADR 0081, decision 12.** A host's name and icon are the host's, in its
  `machine.toml`. `hosts.toml` is a device's: it says whose Projects this
  device's windows show, and its `name` is the device's key for an ssh
  entry, not the name a window shows.
- **The window's rule that the page draws only its own words of another
  machine** (`client/desktop/src/hosts.ts:24-26`,
  `client/web/src/host.ts:80-81`). A machine's name and icon are the one
  exception, cleaned in the page before they draw (decision 2). A
  state's `why` stays the window's words, and drops the machine's key.
- **ADR 0093** stands. Colour stays the account's alone, and its decision
  1 holds on another machine's rows, which draw the emblem picked there.

## Plan

Each step is its own PR.

1. This ADR, with `GLOSSARY.md`.
2. **The engine.** `machine.toml`, its schema and its defaults
   (decision 3); the Welcome's `named`, and the `machine.named` stream;
   setting them through the settings' `set`, the Person's alone
   (`only_the_person`); what the machine is (model, OS), for Settings;
   and `sidebar.toml`'s `[machines]`, `rows = "named" | "icon" | "off"`
   and `this-too = false`. `sdk/contract` only gains fields. The engine
   checks what it reads of `machine.toml`, but no window counts on it
   (decision 2).
3. **The desktop.** `hosts.toml` applied live; adding, removing and
   testing a machine over the bridge, Connect too; Stop Banda on a
   machine; the Hosts of `~/.ssh/config` as suggestions; a state's words
   without the machine's key, "Banda Dev is not open there" (decision 2);
   and `docs/hosts.md`. Only `client/desktop` (`src/hosts.ts`,
   `src/hosts.test.ts`, `e2e/hosts.spec.ts`, `src/main.ts` and the
   bridge) and `docs/hosts.md`.
4. **The window**, in three PRs:
   - **4a, names and icons where the work shows**: the page's cleaning of
     `named` (decision 2) and a machine's icon; the device's last name
     and icon seen, and the key before the first; the rows (decision 5);
     the label and its ⋯ (decision 6); the Pane's header and "Not on arc
     yet" (decision 7); a popped window's title, the notifications and
     the Banda menu (decision 8); and `reachWords` with the machine's
     name. Files: `client/ui/src/hooks/use-status.ts` (beside
     `useMachine`) and a machine's icon in `client/ui/src/components/`;
     `client/web/src/calls/hosts.ts` and `client/web/src/host.ts`;
     `client/web/src/sidebar/Row.tsx` and `Sidebar.tsx`;
     `client/web/src/tiling/PaneFrame.tsx`;
     `client/web/src/window/Popped.tsx`;
     `client/web/src/menu/BandaMenu.tsx`;
     `platform/notifications/pane/src/system.ts`.
   - **4b, writing to another machine**: the composer's placeholder and
     the empty Thread, "Write to Personal on arc", and Send off while the
     machine cannot be reached, with its tooltip, the draft kept
     (decision 7). The tooltip says "Connecting to arc…" while the
     window first tries arc's engine, up to 3 seconds, and "arc is away.
     Send once it is back." after: an engine waits as connecting the
     whole time its machine is away, so connecting again is away too, as
     the pill says. `PaneProps` gains no machine: the Thread Pane reads it
     from `client/ui` by its `args.host`, its name and icon as this
     device last saw them (`useSeenNamed`, beside `seenNamed`) and its
     engine's connection (`useStatus`). Files:
     `client/ui/src/hooks/use-status.ts`;
     `apps/agents/pane/src/composer/Composer.tsx`,
     `composer/placeholder.ts` and `thread/Thread.tsx`;
     `client/desktop/e2e/hosts.spec.ts`. The pill's icon, its minutes and
     its states' actions, as Start, come after B4i, which reshapes the
     Pane's header in `client/web/src/tiling/PaneFrame.tsx`; the picker's
     machine is 4c's.
   - **4c, a New Thread on another machine**: the Project picker grouped
     by machine, and a Thread started in another machine's Project
     opened on that machine's engine (decision 7). The window hands its
     Panes the machines it reaches, each with its open Projects and its
     Host scope's ID, which its No Project is (`MachinesContext` in
     `client/ui/src/hooks/use-machines.ts`, from `KeptHosts.machines`);
     a window of its own hands none, and its picker lists its own
     engine's Projects, as before. The picker lists this machine's
     Projects with no label, then each other machine's, live or away,
     under its label, "away" while it is, each with its own No Project;
     its button names the machine after the Project, "banda ▭ arc". A
     pick reopens the Pane with that machine's `host` (`withHost`), and
     what a Pane on another machine opens keeps a `host` of its own
     (`handleOf`). Moved to another machine, a new Thread drops its
     Harness and its scratch: a Harness of one machine may not be on
     another. This machine's Host scope's ID counts with its Projects, so
     a Pane on arc that picks this machine's No Project opens it here.
     Add Project shows on this machine's Panes only. Files:
     `client/ui/src/hooks/use-machines.ts`;
     `client/web/src/calls/hosts.ts`, `client/web/src/App.tsx` and
     `client/web/src/tiling/PaneFrame.tsx`;
     `apps/agents/pane/src/composer/NewThread.tsx`,
     `settings/ThreadSettings.tsx` and `thread/Thread.tsx`;
     `client/desktop/e2e/hosts.spec.ts`. `client/ui/src/pane.ts` and
     `thread.new` stay as they are.

     _Changed on 2026-11-09 (Roma, #1010):_ a popped-out Pane's window
     hands its Pane the machines too, through the one wrapper the root's
     window hands them by (`client/web/src/window/machines.tsx`), and
     lists each live machine's Projects itself, as it draws no sidebar;
     its picker lists this machine's Projects first, then arc's under its
     label, as the window's does. And one clash rule places an ID on one
     machine in the sidebar and the picker alike (`KeptHosts`): this
     machine's every ID, archived, missing and scratch ones and its Host
     scope's too, then each other machine's in the order of
     `hosts.toml`. Another machine's No Project of an ID this machine has,
     as a copy of its Banda's has, is no longer offered, as a pick of it
     opened this machine's.
   - **The pill, after B4i**: its icon; how long the machine has been
     away, by its label's clock and rule ("arc is away · 2 min" beside
     "away · 2 min"); and Start while Banda is stopped there, the
     Person's click alone. It sits in a band of its own under the Pane's
     header, so it covers none of the Pane (#955). The Tiling draws the
     band, and the Window the pill, in the Slot `pane.header` at `pill`.
     "arc runs another build" waits to come with its "Update arc"
     (#775): with nothing to press, it would put the band on every Pane
     there for as long as the builds differ, and the label says it
     already. Files: `client/web/src/tiling/PaneFrame.tsx`,
     `client/web/src/window/named.tsx`, `client/web/src/calls/hosts.ts`
     (`awayFor`, beside `reachWords`), `client/ui/src/slots.ts` and
     `client/desktop/e2e/hosts.spec.ts`.
   - **H5a, Send says what the pill says** (#948, #951, #824): one rule
     of whether the window reaches a machine, its state and its engine
     being open (`heldWords`, beside `reachWords`). While the machine is
     not live, Send's tooltip says the pill's words, away with "Send
     once it is back."; while it is live, "Connecting to arc…" until its
     engine is open, where 4b counted 3 seconds, or "arc refused this
     window" once that engine said goodbye. Its engine tries again as the
     machine is live (`Engine.wake`), so Send turns on as the pill goes.
     ssh gives up on a machine that does not answer in 10 s, and the
     forward on a link after about 20 s of silence, so one asleep shows
     away in 10 to 20 s, not up to 60 s. The follower still waits out a
     Tailscale sign-in: ssh waits as long for each answer before it is in
     as it lets a link stay silent.
     Files: `client/core/src/hosts.ts`,
     `client/core/src/react/hosts.ts`, `sdk/contract/src/engine.ts`,
     `client/desktop/src/hosts.ts`, `apps/agents/pane/src/thread/Thread.tsx`
     and `client/desktop/e2e/hosts.spec.ts`.
5. **Settings → Machines**, in two PRs:
   - **PR 3, the section**: This machine, Other machines and Add a
     machine (decision 9). Files: `client/web/src/settings/sections.ts`,
     `MachinesSettings.tsx`, `MachinePicker.tsx` and `machines.ts`;
     `client/web/src/window/device.ts` (the bridge's adding, removing,
     testing, changing and suggestions); `client/ui/src/hooks/use-status.ts`
     (`useNamed`, `forgetNamed`); the Banda menu's Machines row, which
     opens its row; `client/desktop/src/hosts.ts`, whose states carry
     their `ssh` and `banda`; and a test at the end of
     `client/desktop/e2e/hosts.spec.ts`.
   - **PR 4, the Show card and what it does**, after the window's B4e
     and B4i, which reshape the sidebar and the Pane's frame it reads.
6. **Later**: another machine's own emblems on its rows (decision 5);
   "Update arc" (#775); a Mac's "not open" in its own words (#826); a
   terminal on another machine, named after its folder (decision 7),
   once there is one.

Steps 4a to 5 are in `client/web`, `client/ui` and the Apps' panes,
which the window's session is reshaping (ADRs 0087 to 0089). They go in
after its Wave 4, each with its list of files agreed with that session
first. The lists above are as main stands.

## Later

- Whether names cut at 64 px read well, once real names show.
- A stopped machine's Projects, as last seen and dimmed: today they go
  (`client/web/src/calls/hosts.ts:79-80`).
