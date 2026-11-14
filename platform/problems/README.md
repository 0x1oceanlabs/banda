# Problems

`platform/problems`, a part of the platform. What broke in Banda itself,
kept on this computer with a fingerprint, so it can be looked into (ADR
0039). It sends nothing anywhere.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract.
- **`skill/`**, its topics of the Banda skill.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0039](../../docs/adr/0039-banda-keeps-its-problems-and-shares-them-only-when-asked.md): Banda keeps its problems, and shares them only when asked

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
