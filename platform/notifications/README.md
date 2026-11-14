# Notifications

`platform/notifications`, a part of the platform. Tells you of what calls,
by toasts and the desktop's notifications; the bell on the bar shows the
last toasts again.

## Where things are

- **`pane/`**, its part in the page: one `defineModule` in
  `pane/src/index.ts`, with its Panes, actions and widgets.
- **`desktop/`**, its part in Electron's main process.
- **`app.toml`**, what no code says ([how a module declares
  itself](../../apps/README.md)).

## Its decisions

[The index](../../docs/adr/README.md) says which of them still bind.

- [ADR 0048](../../docs/adr/0048-the-toasts-are-sonner-s-and-a-bell-shows-the-last-ones-again.md): The toasts are Sonner's, and a bell shows the last ones again
- [ADR 0056](../../docs/adr/0056-the-notifications-module-tells-the-person.md): The notifications module tells the Person

[The architecture](../../docs/architecture.md#modules) is the map this page
is one part of. A change to this part changes this page in the same PR.
