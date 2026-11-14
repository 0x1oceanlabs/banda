# Machines

`platform/machines`, a part of the platform. What this machine is called and
drawn by, the same in every window that shows it: a name of up to 16
characters and one of ten icons, as its own machine.toml says, else as Banda
finds them from its hostname and what it is (ADR 0095). The engine says them
in its welcome, and on the stream machine.named as they change; only the
Person changes them. It also keeps the machine from idle sleep while its
Agents work, and while on power if the Person says so, as machine.toml says,
and says its battery and why it is awake on the stream machine.power, read
only while a window hears it (ADR 0097).

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract.
- Its settings: `~/.config/banda/machine.toml`.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0081](../../docs/adr/0081-banda-runs-on-several-machines-and-banda-cloud-only-connects-them.md): Banda runs on several machines, and Banda Cloud only connects them
- [ADR 0086](../../docs/adr/0086-the-engine-is-the-machine-s-and-outlives-the-window.md): The engine is the machine's, and outlives the window
- [ADR 0095](../../docs/adr/0095-a-machine-names-itself-a-name-and-an-icon-and-no-colour.md): A machine names itself: a name and an icon, and no colour
- [ADR 0097](../../docs/adr/0097-a-machine-stays-awake-while-its-agents-work-and-says-its-battery.md): A machine stays awake while its Agents work, and says its battery
- [ADR 0119](../../docs/adr/0119-each-machine-updates-its-own-banda-in-one-updates-module.md): Each machine updates its own Banda, in one `updates` module

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
