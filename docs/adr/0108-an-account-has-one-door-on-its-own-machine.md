---
status: accepted
date: 2026-11-11
---

# An Account has one door, on its own machine

Roma asked on 2026-11-11 that managing Accounts move into one place, the
UNIX way: input, output, pipes; checked against several machines so that
the data flows and shows correctly. This amends ADR 0104's decision 4 and
its Delivery on how an Account's name, state, default and fallback change.

## What is wrong today

- ADR 0104 says the window, the CLI and Agents use the same operations.
  They write three ways: the engine's methods, the window through its
  device's `banda settings`, and `keys.settings_set` with keys the client
  builds.
- `harnesses.toml` and `agents.toml`'s `[start]` are the machine's
  (ADR 0101, decision 3; ADR 0106, decision 7). The window writing them on
  its own device would change the wrong machine's file.
- The window works out what the engine should say: which Harness an entry
  belongs to, its title, the next name. About 30 places branch on Claude
  Code or Codex.

## Decisions

1. **One door.** Every change to an Account goes through a `harnesses`
   command on the engine of the machine it belongs to. The window, the CLI
   and an Agent are three clients of the same commands.
   - `update_account` changes a name, an emblem, or whether it is offered.
     `set_start` chooses the default and the fallback. `connect_account`
     and `add_gateway` take the emblem at once.
   - An Agent's rights stay ADR 0104's. Its `settings_set` stays the
     general contract for everything else.
   - The settings writer stays the only writer of settings.
   - What a Harness runs (`command`, `args`, `env`) stays the Person's
     alone (ADR 0083). It is written through `keys.settings_set` on that
     machine's engine, never on the device.
   - `connect_account` is a command: it keeps a receipt (ADR 0082,
     decision 4). Typing into a sign-in stays a call, as it repeats.

2. **An Account is one machine's.** Its ID means something only on its
   machine, and the window tells Accounts apart by machine and ID. One
   login on two machines is two Accounts (Roma). A key goes to its machine
   once and never comes back.

3. **A command is a filter.** It takes typed JSON and gives typed JSON.
   - stdout holds only the result. For `banda account` and `banda secret`
     a refusal goes to stderr, with the exit codes as they are. The rest
     of `banda` follows as its own change.
   - A list is a stream, one JSON object a line, narrowed by flags, with
     IDs taken on stdin.
   - A secret travels only on a pipe: stdin in, stdout only for `secret
     get`. Never in arguments or the environment.
   - A long job is one process: stdin is its input, stdout its events, the
     exit code its end.

4. **One answer, followed per machine.** The engine says what an Account
   is: its owner, its Harness's title, its roles, the next name. The
   window reads it per machine and derives none of it.
   - `account_changed` keeps its meaning: a sign-in changed, and every
     process of that Harness goes. A rename must not end a Turn, so a list
     that changed is a fact of its own.
   - While its machine is away the list shows "as of", and a change is
     refused at once (ADR 0106, decisions 7 and 8).

5. **The engine runs a sign-in to its end.** The window watches it on a
   stream and may close. The polling calls stay for Agents, whose tools
   ask and answer.

6. **One table of what differs between Harnesses, and one launch.** One
   row per Harness: its home variable, its sessions, its gateway, its ways
   in. One pure function takes an Account and a Project and gives the
   program, its environment and its files.

7. **The place is `accounts/` inside the module `harnesses`**, in its
   engine and its Pane. A crate of its own would need the Harness list's
   data and the Harness's start each from the other, and would rename
   methods while machines of different versions talk.

## Delivery

One PR per step, in this order: the door; the answer; the CLI's pipes;
sign-in as a stream; the table and the launch; the move into `accounts/`;
bulk acts in the engine, if still wanted. The files move last, so that the
move is only a move.

ADR 0106's step 5a, a new Thread on arc starting on arc's account, stays
that ADR's. Its step 5b, Settings for arc, uses this door.

## Not in this

- Joining the limits of one login on two machines.
- Moving an Account or a key between machines.
- Merging the stores: the files stay as they are, and only the way to them
  changes.
