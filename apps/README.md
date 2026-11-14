# Apps

An App is one folder here, a part of the platform one folder in
`platform/`, and both declare themselves the same way. This page says
how. Each App's own page is its folder's `README.md`.
[The architecture](../docs/architecture.md#modules) is the map this page
is one part of. A change to how a module declares itself changes this
page in the same PR.

## How a module declares itself

A module declares itself in its code and a short `app.toml` (ADR 0022,
which calls it `module.toml`).
Its engine part is the `Module` it gives the kernel, with its `methods!`
table. Its window part is one
`defineModule({ id, engine, panes, watches, actions, sources, bar, slots, previewers, items, start })`
exported from its Pane package; the window lists these in
`client/web/src/modules.ts`, the one place that names a module, and builds its
registries from them. `start` runs once with the window API, for a module
that acts on the window when the desktop tells it something.
`slots` are what it puts in other Apps' things, each a Slot by its name
(ADR 0082, decision 8; `@banda/ui/slots`): Git's rows in Threads'
`thread.details`, a Thread's details card (ADR 0034), and Threads' Mark of
a Thread in the Tiling's `pane.header`, a Pane's header and its tile's
label in the Overview (ADR 0062, decision 17), where the window names
another machine too. The window gives what the modules that run put in
each (`Slots`), and each Slot's owner reads its own in one place
(`useSlot`), in the modules' order. A Pane's header gives what fills it
the Pane alone: Threads finds the Thread it shows among what the Apps
list, which the window gives them (`useItem`, #943). A Pane puts
its own buttons in the header the frame draws with `InHeader`. Threads'
own action `agents.thread.details{part}` shows the focused Thread's card
with a part of its rows open, as git's Alt+Shift+G runs it for its branch
picker.
`items` are its item actions (ADR 0087, decision 12): what the Person
does to one of the Items it lists, as renaming or putting a Thread off. Each
is an action, by a key too, with the row it shows for an Item; the Thread
menu lists them, its App's and then the sidebar list's Archive, and the
Pane menu and the Banda menu's Tab those offered there. The window finds
an Item's App by the first word of its Pane kind, and runs each by id.
`previewers` are how it draws kinds of file (ADR 0073, decision 6): each
`definePreviewer({ id, title, match, priority, can, load })`, whose view
`load` imports only once a file of its kind is shown. The window gathers
every module's and gives them to its Panes as `@banda/ui`'s
`Previewers`; `pickPreviewer` takes the Person's pick for the extension,
else the closest match (extension, MIME, MIME family, first bytes), then
the higher priority. A view is keyed by its previewer, so the next file of
its kind updates it rather than drawing it anew.
`app.toml` holds only what no code says. Its `kind` is `app` in
`apps/` and `platform` in `platform/`; `api` is the major of the App
API it is written to, a whole number; `[needs]` stays empty until what
an App needs (ADR 0082, decision 2) is built. The window's own part
declares itself in `client/web/app.toml` too, with no `kind`, `api` or
`[needs]`, as it is neither an App nor a platform part (ADR 0087,
decision 1).
`banda modules` prints the three as one JSON per module
(`engine/src/modules.rs`), and the skill's `modules` topic is written
from it. The serving engine reads the window parts too: the keys in
force take their actions and scopes (ADR 0071, decision 2), and the
workspaces, as they start, the Pane kinds that open as a Group of their
own (`PaneKind.grouped`), so a Thread is a Group from its opening whoever
opens it (ADR 0065, decision 7), those that stand on their Project's
workspace (`PaneKind.home`), and those that are lists (`PaneKind.narrow`),
whose new column takes the narrowest of `tiling.toml`'s widths whoever
opens it (ADR 0127, decision 4). For those kinds, a window part it
cannot read it logs and leaves out. A path a module takes that the
contract lacks is an unstable mark in its `app.toml`, with why; the tests
hold the count at a ceiling that only falls, and `scripts/check.sh`
prints them.

**One list of Apps.** `engine/build.rs` scans the folders of `apps/` and
`platform/` with an `app.toml`, Apps first, each bucket by name. It
refuses a manifest whose id is not its folder's name, whose kind is not
its bucket's, or whose `api` or `[needs]` is wrong, and a folder with a
part's files (`engine/Cargo.toml`, `pane/` or `desktop/`'s
`package.json`, `window.json`) but no manifest. It writes the list
`engine/src/apps.rs` includes: each manifest and `window.json`, and the
engine parts `banda serve` builds, in its order, each by its builder
there (one function per App's id: a part with none fails the build, a
builder with no part fails clippy). The engine serves those and no
other, as the contract's tests check against `banda modules`. The lists
still kept by hand are held to it by the engine's tests:
`engine/Cargo.toml`'s crates and the workspace's members, the settings'
window parts (until B2), and the window's `client/web/src/modules.ts`
and `client/desktop/src/modules.ts`; the tests write the contract's
`Methods` (`sdk/contract/src/generated/Methods.ts`) from it.
