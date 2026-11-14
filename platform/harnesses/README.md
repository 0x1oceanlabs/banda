# Harnesses

`platform/harnesses`: the machine's Harnesses, their Accounts and their
usage, and the code that speaks to a Harness.
[The architecture](../../docs/architecture.md#harnesses) is the map this
page is one part of. A change to this part changes this page in the same
PR.

## What it does

- **The machine's Harnesses** (ADR 0040): the ones this computer can
  start, and who is signed in to each, with no Project, so a Person signs in
  before making one. `harnesses.list`, `harnesses.account` (with the
  machine's log position it is current at), `harnesses.sign_in {harness,
  way}` and `harnesses.sign_out`. It owns `harnesses.toml`.
- **What differs between Harnesses is one table** (ADR 0108, decision
  6): `platform/harnesses/engine/src/kinds.rs` has a row for Claude Code
  and one for Codex (its home variable and default home, its CLI's
  variable, its journals, how an API key account signs in, whether it
  signs in with a device code, whether a gateway asks for its key with a
  helper) and how each reaches a gateway. Accounts, profiles, usage,
  limits and shadows ask `Kind::named` (by ID) or `Kind::of` and the
  row; what a launch does per Harness (Codex's shell variables, Claude
  Code's sessions folder) moves into one launch next.
  `tests/launch.txt` pins what each kind of entry starts as.
- **A machine says what its Accounts are in one answer** (ADR 0108,
  decision 4): `harnesses.accounts` gives each entry, the Harnesses they
  are accounts of with their title and what a new one is called, and the
  default and the fallback, by the rule that an account that is off takes
  no role and the fallback is never the default. It follows the folders
  the list is made from and writes `harnesses.list_changed` each time the
  answer reads otherwise, whoever changed it: a command, `banda`, or a
  hand in the file. The window keeps one answer per engine
  (`useAccountList`), read again on that fact and kept as of while the
  machine is away; it works out none of it. A rename is a `list_changed`
  and never an `account_changed`, which ends processes.
- **An Account changes through one door, on its own machine** (ADR 0108).
  `harnesses.connect_account`, `update_account` (a name, an emblem, whether
  it is offered) and `set_start` (the default and the fallback) are
  commands: the window and `banda account` call them on the engine of the
  machine the Account belongs to. What a Harness runs stays the Person's,
  written with `keys.settings_set` on that engine.
- **The engine runs a sign-in to its end** (ADR 0108, decision 5): as it
  ends the engine lets go of the Harness's processes and writes
  `account_changed`, then says it is done. The window watches it on
  `harnesses.login_watch` and may close; `banda account login` is one
  process, stdin its input, stdout its events, the exit code its end. The
  polling calls stay for Agents' tools; `login_finish` only lets go of
  the report.
- **`banda account` and `banda secret` are filters** (ADR 0108, decision
  3): the result alone on stdout, a list one JSON object a line narrowed
  by flags, IDs on stdin for `-`, a refusal as JSON on stderr
  (`engine/src/account.rs`).
- It asks through a Harness process of its own, with no session, in a
  pool keyed by the machine's ID, let go after five minutes with nothing
  asked.
- **A sign-in or sign-out writes `harnesses.account_changed`**, its
  subject the Harness's ID and nothing else. Every holder of that
  Harness's process lets go of it: this module, and each Project's agents
  module, which hears the machine's log (`ModuleProject::listen_to_machine`)
  and lets go of its own hosts of it without waiting. A host that was
  starting then is let go the next time it is asked for (`hosts.rs`
  marks it stale). The command answers once every reaction handled
  the event, so a call after it finds every old process gone.
- **The code that speaks to a Harness is the crate `banda-harnesses`**,
  which knows nothing of Threads: the list and its file, finding the
  Person's CLI, a process (`acp::Process`: starting, recording, agreeing
  on ACP, who is signed in) and the pool of processes. A process starts
  in the environment of the Project the pool is asked for, and ACP speaks
  on its pipes (`acp/pipes.rs`); a short run apart from a Thread runs in
  the Thread's process. That program is the entry's start: a carried
  Harness's is its adapter, on Node, which runs the CLI. The CLI is found
  on the host and asked its version in the environment, and with `local`
  all of it runs on the host. ADR 0084's split, the adapter on the host
  and its CLI in a box, found there, comes with the `container` adapter
  (its decision 5, plan step 3). The agents module wraps a process with
  its sessions' handlers and capabilities. The agents module and
  `harnesses` share one list. The version a CLI says is kept by its path
  as the latest look found it, by any process, and checked against its
  entry's `minimum` at each read: a Thread stops warning once the Person
  updated it and checked again.

- **Usage comes from local journals** (ADR 0043). `harnesses.usage`
  returns tokens and estimated USD API cost for a half-open interval of up
  to 90 days, defaulting to 24 hours, with UTC-day, Harness and model rows.
  `read: true` first scans Claude Code and Codex journals; an open window
  also causes a scan every minute. `[usage] read = false` stops reading;
  previously counted totals remain available. Offsets and parser state
  are committed with counters, and records older than 92 days are pruned.
  Repeated records and entries sharing a folder count once. The store
  retains counters and session identifiers, never conversation text.
  `harnesses.usage_changed` tells a window to ask again. This method is
  not an Agent tool: it describes all local sessions, including those
  outside Banda. Price data ships with the engine; collection makes no
  provider request.
