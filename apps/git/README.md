# Git

`apps/git`, an App. The Project's folder as git sees it: its branch, its
changes, and the diff against a base, the last commit or the index; it
stages, unstages and reverts them, commits, pushes and pulls, and switches
and makes branches.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract.
- **`pane/`**, its part in the page: one `defineModule` in
  `pane/src/index.ts`, with its Panes, actions and widgets.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0034](../../docs/adr/0034-development-is-modules-in-panes-beside-the-thread-as-in-t3-code.md): Development is modules in Panes beside the Thread, as in T3 Code
- [ADR 0116](../../docs/adr/0116-a-thread-moves-to-a-project-on-another-machine-and-the-device-carries-it.md): A Thread moves to a Project on another machine, and the device carries it

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
