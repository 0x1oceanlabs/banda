# Devices

`platform/devices`, a part of the platform. The devices this machine lets in
at its door, and the host key it proves itself to them by (ADR 0124): a
desktop's window, a browser, a phone or a CLI on another machine, each by a
key of its own that never leaves it. Only the Person pairs or removes one,
and a device removed loses its sessions at once.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract:
  `devices.list`, `devices.add`, `devices.remove`, `devices.asking`,
  `devices.allow`, `devices.refuse`, `devices.hand`.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0124](../../docs/adr/0124-every-client-reaches-every-machine-by-one-road-at-its-door-by-its-own-key.md): Every client reaches every machine by one road: at its door, by its own key

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
