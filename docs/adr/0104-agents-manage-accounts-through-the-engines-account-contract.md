---
status: accepted
date: 2026-11-10
---

# Agents manage Accounts through the engine's Account contract

Roma asked on 2026-11-10 that Agents connect and manage Accounts through
Banda's CLI, without preparing a shell script for the Person to run. This
extends ADR 0078's Add account and ADR 0093's account settings to the CLI
and amends ADR 0083's restriction on changing Harness entries through an
Agent's pass, only for the bounded Account operations below.

## Decision

1. The window, CLI and Agents use the same engine operations to discover,
   connect, create and manage Accounts. `banda account` is the CLI entry;
   it uses the caller's existing pass, never owner access obtained by
   dropping that pass. Each operation says its result or a specific refusal.
2. An Agent may connect an existing profile of a registered Claude Code or
   Codex Harness, or create an Account with its own folder under this
   Banda's data folder. The operation accepts an Account ID and name, a
   Harness ID and a profile folder; it accepts no program, arguments,
   arbitrary environment or credential content. The engine chooses the
   one profile variable. Existing folders stay owned by their creator.
3. Profile discovery lists the Harnesses' ordinary homes and Omarchy's
   account folders. It reads folder names, not credentials. A folder found
   is a candidate, not proof of a valid subscription. The Harness reports
   whether its sign-in holds. Connecting the same folder twice is refused.
4. Agents may rename an Account, enable or disable it and choose the
   default and fallback through the existing validated settings contract.
   They cannot change what a Harness executes, grant Project trust, sign
   out another Account or read credentials through these operations.
5. Sign-in remains the Harness's own flow. An Agent may initiate it; the
   Person completes any browser or interactive step. The engine owns that
   process and the Account's folder. Codex also offers its CLI's fixed
   `login --device-auth` flow so a Person on another computer can open the
   verification page; callers supply no program or arguments. An exit code alone is not proof of
   sign-in: ask the Harness again. The CLI explains what is waiting and
   how to continue; it never returns the stored credentials.
6. Removing an Account does not sign it out. Its active Turn finishes on
   it, and its Threads then use the default, as ADR 0093 says. Only a
   folder Banda created for that Account can be deleted. An incomplete
   move is reported and keeps the Account available; removing the default
   requires a different default first.

## Delivery

The existing general settings writer stays the only writer of settings.
The Account contract validates its inputs before invoking that writer;
it does not make `settings_set`'s arbitrary Harness execution keys writable
to Agents. Tests cover the same calls under a Person and an Agent pass,
invalid IDs and folders, duplicate connections and retained credentials.

### Removing an Account

Removal records its destination and caller in the existing settings entry.
The Account leaves pickers and refuses new Threads immediately. Each
Project moves its idle Threads, including archived Threads, through its own
store; a running Turn keeps its Account and moves once it ends. A Project
opened later applies the same instruction. The next Turn also checks it,
so a queued Turn cannot race a listener. The receipt is idempotent.

The old entry remains as session provenance: Codex may need its old home
to resume a session, and another Harness needs its name for a handoff.
Profile folders are retained, including Banda-created folders, until no
session needs them; removal never recursively deletes provider data.
This makes explicit the ownership condition in ADR 0093 decision 9; it
is not permission to delete an adopted folder. Automatic reclamation is
separate maintenance. Missing or disabled destinations cause a visible
refusal; a removal cannot target itself, remove the default, or remove a
Harness whose other Accounts still inherit its program.
