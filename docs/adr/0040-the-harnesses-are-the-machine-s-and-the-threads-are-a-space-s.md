---
status: accepted
date: 2026-11-03
---

# The Harnesses are the machine's, and the Threads are a Space's

Issue #172. The module `agents` is a Space's (ADR 0001), and it holds two things:

- **a Space's work**: its Threads, Turns, messages and Questions, kept in the Space's log;
- **this computer's programs**: the Harness list in `~/.config/banda/harnesses.toml`, who is signed in to each, and signing in and out. The method `agents.account` itself says "a Harness's account serves every Space on this computer".

The second part needs a Space only because its module does. So the settings Pane's Agents section (`app/web/src/settings/Agents.tsx`) takes the first Space from `spaces.list` to ask in. With no Space it shows "A Harness starts in a Space" and nothing else. A Person who just installed Banda cannot sign in before making a Space.

What the code has now:

- ADR 0025 gave the kernel a machine scope. A module says `Module::scope() == Scope::Machine`, and its methods name no Space. `workspaces` is the only such module.
- The machine's scope is a store with its own log, as a Space's is. A module of a Space reacts to its own Space's log through `ModuleSpace::react`, as git keeps a checkpoint as a Turn starts (ADR 0034). `ModuleSpace::reacted` waits until every reaction has handled the log.
- `agents.sign_in` does two jobs. It signs in, then it tries again the `turn` that needed the sign-in.
- A Harness process starts with no folder of its own: a Space's folder is given per session (`session/new`). The hosts (`hosts.rs`) are keyed by Space and Harness, and each is let go after half an hour with nothing to do. After a sign-in, `Live::let_go` lets go of that Harness's hosts in every Space, so each one reads the account again. It waits for a host that is starting, up to two minutes.
- A terminal Pane's `done` is the one call it sends as its program ends, in the terminal's Space. A sign-in in a terminal ends with `agents.sign_in`.
- The window follows the machine's log for `workspaces` only. The Agents section asks the cards again by remounting them as a sign-in's terminal closes.
- Who is signed in comes from the Harness's own `_auth/status_update` (`acp/account.rs`). Banda never reads the Harness's files.

Three ways were weighed:

- **A second module that shares memory with `agents`.** It would work, but the two would share the hosts, which modules never do: they talk only by commands and events.
- **One module in both scopes.** The kernel would route some of a module's methods to the machine. The module would still do two jobs, and the kernel would grow a special case.
- **A module of the machine, and an event.** Each module does one job. They share code, not state.

Roma, 2026-11-03: the third. "Modular, beautiful and elegant, as in Unix."

## Decision

1. **The module `harnesses` is the machine's.**
   - It knows the Harnesses this computer can start, and who is signed in to each.
   - Its methods name no Space:
     - `harnesses.list`: the Harnesses, as `agents.harnesses` answers now;
     - `harnesses.account`: a Harness's program, who is signed in, and the ways to sign in, with the log's position it is current at, as git's answers carry;
     - `harnesses.sign_in`: signs in with one of those ways, and only that;
     - `harnesses.sign_out`.
   - It owns `harnesses.toml`, and the settings Pane's Agents section shows the file under it.
   - It asks through a Harness process of its own, with no session. The process lives in the same pool as a Thread's hosts (`Hosts`), keyed by the machine's ID, and is let go after five minutes with nothing asked.

2. **A sign-in or sign-out writes `harnesses.account_changed` to the machine's log.**
   - Its subject is the Harness's ID. It carries nothing else: the account itself is the Harness's, and stays with it (ADR 0003).
   - Every holder of that Harness's process lets go of it on the event, `harnesses` too: none answers from the old account.
   - The command answers once every reaction has handled the event (`reacted`). So a call after it finds every old process gone.
   - The window follows the machine's log for `harnesses` too, as it does for `workspaces`. A Harness's card and a Thread's sign-in card read the account again when the event comes. The Agents section's remount goes.

3. **A module of a Space may hear the machine's log.**
   - The rule is the kernel's, for every module. A Space's `ModuleSpace` gives a handle to the machine's log that can only hear it: a module of a Space never writes there.
   - A module reacts to it as to its own Space's log, from `opened`, as git does (ADR 0034). The reaction starts at the log's head, not from its start, and ends as its Space closes. The machine's `reacted` counts it like any other.
   - A module of the machine still never hears a Space's log. The wall stays one way.

4. **`agents` keeps a Space's work, and hears the machine.**
   - Its four methods `harnesses`, `account`, `sign_in` and `sign_out` go.
   - On `harnesses.account_changed`, each Space lets go of its own hosts of that Harness. Its next Turn starts with the new account.
   - Letting go waits for no host that is starting. Each host keeps the count of account changes it started after, and one started before the latest is let go when it is next asked for. So the reaction is quick, and a sign-in never waits on a start.
   - Each module reads `harnesses.toml` through its own `Harnesses`, which reads the file again as it changes (`Harnesses::now`). They share the file, not a handle.

5. **A sign-in from a Thread is two commands, one after the other.** The window sends `harnesses.sign_in`, then `agents.retry` for the Turn, if the first went through.
   - A terminal Pane's `done` becomes a list, run in order. Each call runs only if the one before it went through, as `a && b` does.
   - Each call in it says where it runs: a Space, or the machine. `harnesses.sign_in` runs on the machine, and `agents.retry` in the Thread's Space.
   - `agents.retry` of a Turn that went again already answers that nothing was left to do, as `mkdir -p` does, rather than a refusal. Two windows, or "I signed in" before the terminal closed, may both have asked.
   - With no Space there is no terminal. A way that runs in a terminal then shows its command line to run by hand, and "I signed in" (`SignIn.tsx`'s `TerminalWay` with no terminals, as a window without them has now). A terminal of the machine is not needed for this.

6. **The code that speaks to a Harness is a library both modules use.**
   - The crate `banda-harnesses` (`modules/harnesses/engine`) holds what is about a program on this computer:
     - the entry and its list;
     - finding the Person's CLI (`cli.rs`);
     - starting the process, recording it, and agreeing on ACP;
     - its ways to sign in and who is signed in;
     - the pool of processes (`hosts.rs`).
   - `agents` adds to that client what a session needs: its handlers and the capabilities it declares, its Threads' turns, what they say and what they ask. It wraps the library's connection.
   - `banda-harnesses` does not depend on `agents`. It is the lower layer: a Thread runs on a program, but a program knows nothing of Threads.

## Consequences

- The settings Pane's Agents section works with no Space. It drops its lookup of the first Space and its message.
- Signing in on a new machine needs no Space. The first run (ADR 0033, step 7) can show the Harnesses before the first Space exists.
- A Turn that needed a sign-in goes again by `agents.retry`, which needs `Write`, as a Person's retry does now.
- A terminal Pane runs a list of calls in their own places. Any module may end a program in a terminal that way.
- `docs/architecture.md` gets the module `harnesses` in its list of modules, and its words: Harness and account.

## Steps

1. **The kernel:** a Space's handle to the machine's log that only hears, reacted to from `opened`, counted by the machine's `reacted` (decision 3).
2. **The library:** `banda-harnesses`, moved out of `agents`, which then depends on it. No change in what Banda does (decision 6).
3. **The module `harnesses`:** its four methods, `account_changed`, and `agents` hearing it and letting go without waiting (decisions 1, 2 and 4). The four methods of `agents` stay for now, so the window keeps working.
4. **The window:** the settings Pane, the Thread's sign-in card and the composer ask `harnesses` and follow its events, a terminal's `done` becomes a list, and `agents.retry` of a Turn that went again answers nothing left to do. Then the four methods leave `agents` (decisions 2, 4 and 5).
