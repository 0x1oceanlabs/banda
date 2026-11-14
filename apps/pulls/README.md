# Pull requests

`apps/pulls`, an App. The GitHub pull requests linked to a Project's Threads
(ADR 0076): Create PR's, an Agent's own `gh pr create`, its tools' and the
Person's. It reads them through `gh`, one reader for the Project while
something follows it, and works out what each needs and whose turn it is.

## Where things are

- **`engine/`**, its part in the engine. The head of `engine/src/lib.rs`
  says what it does and why, and its `methods!` table there is its contract.
- **`pane/`**, its part in the page: one `defineModule` in
  `pane/src/index.ts`, with its Panes, actions and widgets.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0076](../../docs/adr/0076-a-thread-s-pull-requests-are-watched-and-the-bar-shows-whose-turn-it-is.md): A Thread's pull requests are watched, and the bar shows whose turn it is

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
