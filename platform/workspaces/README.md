# Workspaces

`platform/workspaces`, a part of the platform. How this machine's Panes are
arranged: workspaces one under another, each a Strip of columns.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract:
  `workspaces.list`, `workspaces.open`, `workspaces.close`,
  `workspaces.update`, `workspaces.move_pane`, `workspaces.move_column`,
  `workspaces.move_workspace`, `workspaces.size`, `workspaces.height`,
  `workspaces.even`, `workspaces.maximize`, `workspaces.display`,
  `workspaces.group`, `workspaces.regroup`, `workspaces.move_group`,
  `workspaces.fill`, `workspaces.tidy`, `workspaces.arrange`,
  `workspaces.take`, `workspaces.set_aside`, `workspaces.bring_back`,
  `workspaces.unarrange`, `workspaces.panes`, `workspaces.open_pane`,
  `workspaces.move_own`, `workspaces.close_own`.
- Its settings: `~/.config/banda/tiling.toml`.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0005](../../docs/adr/0005-a-hackable-tiling-workspace.md): A hackable tiling workspace: one list of actions, calm tiles, modules on an open contract
- [ADR 0019](../../docs/adr/0019-an-agent-works-with-threads-as-a-person-does.md): An Agent works with Threads as a Person does
- [ADR 0025](../../docs/adr/0025-the-workspaces-live-in-the-engine-and-the-mouse-works-them-as-niris.md): The workspaces live in the engine, and the mouse works them as niri's
- [ADR 0029](../../docs/adr/0029-an-agent-drives-a-tab-with-banda-s-own-tools-beside-its-thread.md): An Agent drives a tab with Banda's own tools, beside its Thread
- [ADR 0032](../../docs/adr/0032-an-agent-sees-other-spaces-panes-when-its-person-lets-it.md): An Agent sees other Spaces' Panes when its Person lets it
- [ADR 0039](../../docs/adr/0039-banda-keeps-its-problems-and-shares-them-only-when-asked.md): Banda keeps its problems, and shares them only when asked
- [ADR 0065](../../docs/adr/0065-columns-group-the-deck-moves-to-alt-t-and-an-agents-panes-are-its-group.md): Columns group, the Deck moves to Alt+T, and an Agent's Panes are its Group
- [ADR 0083](../../docs/adr/0083-banda-keeps-its-own-state-out-of-an-agents-reach-and-only-the-persons-gesture-acts-as-the-person.md): Banda keeps its own state out of an Agent's reach, and only the Person's gesture acts as the Person
- [ADR 0087](../../docs/adr/0087-the-window-holds-the-areas-the-tiling-the-panes-and-here-is-their-context.md): The Window holds the areas, the Tiling the Panes, Apps fill them, and Here is their context
- [ADR 0088](../../docs/adr/0088-motion-runs-on-the-compositor-and-content-takes-its-size-once.md): Motion runs on the compositor, and content takes its size once
- [ADR 0101](../../docs/adr/0101-machines-are-peers-and-there-is-no-home-host.md): Machines are peers, and there is no home host
- [ADR 0102](../../docs/adr/0102-in-the-row-and-solo-a-project-has-its-own-workspace-and-free-workspaces-hold-the-rest.md): In the row and solo, a Project has its own workspace, and free workspaces hold the rest
- [ADR 0110](../../docs/adr/0110-where-a-pane-opens-is-one-rule-in-the-workspaces-module.md): Where a Pane opens is one rule, in the `workspaces` module
- [ADR 0127](../../docs/adr/0127-the-window-shows-and-asks-and-each-thing-has-one-place.md): The window shows and asks, and each thing has one place

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
