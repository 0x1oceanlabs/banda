# Account management: ownership review

Roma asked on 2026-11-10 to inspect weak points and put Account management
behind one deep module after Omarchy discovery. This review covers the
code at PR #1212, then the refactor on top of it; it is not a proposal to
change sign-in permissions or the settings format.

## Findings in the original boundary

- `platform/settings/src/accounts.rs` owned profile discovery, folder
  identity, input validation, private-folder creation and rollback. Its
  `AccountSettings` interface looked like persistence but owned most of
  the Account policy. A new Account source therefore required changing
  Settings as well as Harnesses.
- `platform/harnesses/engine/src/module.rs` mixed dispatch and rights with
  provider-process ownership, sign-in way selection, PTYs, cancellation,
  completion and account-change publication. The separate `Logins`
  helper was useful, but the caller still orchestrated the lifecycle.
- `platform/harnesses/engine/src/omarchy.rs` repeated the mapping from
  Harness IDs to profile variables and default folders already in
  Settings. The two sources could diverge when adding a Harness.
- `Profiles::connected` repeatedly reloaded the effective list while
  checking candidate folders. Discovery now takes one request-local
  snapshot and builds a canonical-folder lookup; no persistent cache or
  invalidation rules are needed.
- The connect picker assumed `~/.local/state`, while automatic Omarchy
  discovery honoured `XDG_STATE_HOME`. Both now use one path resolver,
  with a test for a nondefault state directory and a relative-path fallback.

## Implemented boundary

`accounts::Accounts` owns connections and provider sign-in. Its private
parts keep profile rules, Omarchy discovery and bounded sign-in jobs.
The RPC module delegates and retains the same method names, types, rights
and command receipts. Omarchy uses the same profile-variable mapping as
manual connections.

`AccountStore::save` takes a prepared connection whose construction is private to Accounts. The production adapter
in Settings only turns that data into the existing writer's input. It
has no Harness list, discovery, folder creation or lock. The Accounts
service owns the connection lock and failure cleanup. Tests can refuse
persistence without building every module whose settings Banda describes.

The effective Harness list stays its existing owner: account discovery
supplements it through a private adapter, and explicit settings still
win. Native ACP program detection remains in that Omarchy adapter; it
must not be mistaken for proof of an Account's sign-in.

## Boundaries deliberately retained

- Provider credentials remain the provider's. This refactor reads none.
- Settings remains the only writer, preserving comments and validation.
  Rename, enable and Emblem still use that existing contract;
  introducing another writer or silently changing removal semantics would
  be a separate behaviour change. The existing generic writer also
  materializes discovered entries on first edit, including native ACP
  programs; that path remains in Settings and is not the AccountStore
  connection adapter.
- Threads own default/fallback selection and switching, since those
  decisions affect their histories and active Turns. Accounts knows no
  Thread or Project data.
- Limits and Usage keep their readers and hear the unchanged account
  event. They are not folded into a service merely because they use an
  Account ID.

## Verification

Existing profile and sign-in tests move with their owner. New cases cover
refused persistence, retry after cleanup, keeping adopted folders and
keeping provider data written before a failed save. A Settings integration
test connects through the real service and checks the written profile,
comments and unrelated settings. Engine and Agents integration tests
exercise the unchanged API and account-change reactions.

## Pre-PR code review

Three read-only passes reviewed reuse and ownership, correctness and
contracts, and efficiency and lifetimes. The new prepared-connection
record initially had public fields; those are now private to Accounts,
with read-only accessors for persistence. Review also led to the shared
XDG resolver and the request-local discovery snapshot above.

No introduced changes were found in RPC rights, command receipts,
account-change publication, sign-in cancellation, timeouts or process
holds. Generic settings materialization remains an explicit boundary,
not a claim that every account-related settings operation moved here.

After #1212 merged, main added Account retirement. The rebase keeps its
validation and event publication in Accounts, with Settings reading the
Thread selection and persisting an opaque prepared retirement. Review
caught and fixed retired entries in the duplicate-folder snapshot; the
removal test now also reconnects the retained folder under a new ID.
The program-ownership architecture test now names accounts/mod.rs.
