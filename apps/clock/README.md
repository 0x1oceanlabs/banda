# Clock

`apps/clock`, an App. The day and the time on the bar, by this device's
clock and language, for when the system's own bar is hidden, as in full
screen; a click shows the month, with its weeks' numbers.

## Where things are

- **`pane/`**, its part in the page: one `defineModule` in
  `pane/src/index.ts`, with its Panes, actions and widgets.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
