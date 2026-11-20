# Workspaces

`platform/workspaces`, a part of the platform. How this machine's Panes are
arranged: workspaces one under another, each a Strip of columns.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract.
- **The Tiling's model** is a crate of its own beside this part,
  [`platform/tiling`](../tiling/src/lib.rs) (`banda-tiling`): the
  arrangement and its rules (`model.rs`), where a Pane with no place goes
  (`placing.rs`), the commands as functions of the arrangement
  (`commands.rs`), the words of `tiling.toml` they read (`rule.rs`,
  `columns.rs`), and what a device looks at with what a change does to
  it (`view.rs`: the focus, the screen, and where the focus goes back to
  after a close; ADR 0135, decisions 7 and 9). It is a leaf, with no store, file or clock, so it also
  builds for a client as WebAssembly (`cargo build -p banda-tiling
  --target wasm32-unknown-unknown`; ADR 0088, decision 11), and its
  `tests/leaf.rs` holds it one. The engine's part keeps the arrangement
  and calls it. Its `tests/traces.rs` records the golden traces in
  `traces/` here. The window loads the model as one WebAssembly file,
  [`platform/tiling/wasm`](../tiling/wasm/src/lib.rs)
  (`banda-tiling-wasm`): a command as JSON in, its answer as JSON out. The
  window's build makes the file (`tilingModel` in
  `client/web/vite.config.ts`), the window draws ahead of the engine by
  it (`client/web/src/tiling/engine.ts`), and its `parity.test.ts`
  replays the traces through it.
- **What an Agent may open** is each App's own to say: its engine part's
  `AGENT_PANES`, a kind with the rule its args keep, what an Agent sees of
  it and the folder it shows (`AgentPane` in
  `platform/tiling/src/agent.rs`). The engine hands them over as it
  starts (`agent_panes` in `engine/src/apps.rs`), so this part names no
  App for them: its Project's Threads, the Diff, a file, Files on a
  folder of its Project and a browser at a web address. An App's screen
  (`apps.view`) is the platform's own. A new kind is a line in its App,
  and one in that list. `open_pane` is its one door, and `banda files` in
  an Agent's shell goes through it (ADR 0134, decision 4):
  `workspaces.open` is refused an Agent's pass.
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
- [ADR 0120](../../docs/adr/0120-what-stage-2-left-for-another-machine-goes-by-the-roads-it-built.md): What stage 2 left for another machine goes by the roads it built
- [ADR 0127](../../docs/adr/0127-the-window-shows-and-asks-and-each-thing-has-one-place.md): The window shows and asks, and each thing has one place

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
