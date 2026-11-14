# Sharing

`platform/sharing`, a part of the platform. The one part of Banda that sends
anything anywhere (ADR 0039, decision 4): problem reports and usage counts,
each only while the Person turned it on, and each kept here first, as it
goes.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract:
  `sharing.state`, `sharing.new_id`, `sharing.example`.
- Its settings: `~/.config/banda/sharing.toml`.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0039](../../docs/adr/0039-banda-keeps-its-problems-and-shares-them-only-when-asked.md): Banda keeps its problems, and shares them only when asked
- [ADR 0101](../../docs/adr/0101-machines-are-peers-and-there-is-no-home-host.md): Machines are peers, and there is no home host

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
