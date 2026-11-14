# Keys

`platform/keys`, a part of the platform. Banda's keys (ADR 0071): every
action with its keys in force, and the lines of keys.toml that bind them,
written as `banda settings set` writes after the look's checks. `banda keys`
is its command; an Agent has its methods as tools. It writes the rest of
Banda's settings for an Agent too, whose files are read-only behind the
fence, and refuses what only the Person changes (ADR 0083). It reads a
machine's own part of each settings file, and says as it changes, for a
window of another device (ADR 0106).

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract:
  `keys.list`, `keys.act`, `keys.bind`, `keys.free`, `keys.reset`,
  `keys.set_mod`, `keys.settings_set`, `keys.settings_reset`,
  `keys.settings_rename`, `keys.settings_read`, `keys.settings_changed`.
- **`skill/`**, its topics of the Banda skill.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0068](../../docs/adr/0068-the-mod-is-the-person-s-and-every-key-shows-as-it-is-pressed.md): The mod is the Person's, and every key shows as it is pressed
- [ADR 0071](../../docs/adr/0071-every-key-is-an-action-s-and-the-person-an-agent-and-an-app-bind-it-alike.md): Every key is an action's, and the Person, an Agent and an App bind it alike
- [ADR 0083](../../docs/adr/0083-banda-keeps-its-own-state-out-of-an-agents-reach-and-only-the-persons-gesture-acts-as-the-person.md): Banda keeps its own state out of an Agent's reach, and only the Person's gesture acts as the Person
- [ADR 0087](../../docs/adr/0087-the-window-holds-the-areas-the-tiling-the-panes-and-here-is-their-context.md): The Window holds the areas, the Tiling the Panes, Apps fill them, and Here is their context
- [ADR 0106](../../docs/adr/0106-another-machine-s-panes-run-on-its-engine-and-this-device-only-draws-them.md): Another machine's Panes run on its engine, and this device only draws them
- [ADR 0127](../../docs/adr/0127-the-window-shows-and-asks-and-each-thing-has-one-place.md): The window shows and asks, and each thing has one place

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
