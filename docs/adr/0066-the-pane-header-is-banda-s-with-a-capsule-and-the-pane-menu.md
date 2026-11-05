---
status: accepted
date: 2026-11-05
---

# The Pane header is Banda's, with a capsule and the Pane menu

A Pane's header today is drawn three ways. The frame draws most
(`PaneHeader`); a Pane puts its own buttons in it through `InHeader`; the
frame adds its pop-out button through `TileActions`. Four Panes draw the
whole header themselves (`header: false`): the browser, the Diff, Usage
and the settings. So the Diff's header has no title, the browser's no
icon, and each puts its buttons where it likes. Every tiling action has a
key (ADR 0025, decision 4) and none has a mouse path but the gaps, though
ADR 0005, decision 1, says every action has one. The pop-out button sits
in every header, though it is seldom used: it stood in for the header's
menu ADR 0025, decision 9, named, as the window had none.

Roma, on 2026-11-05: hide "open in its own window", and put there the
tiling menu we lack, as all of it is keys; and make the header one thing:
what an App passes in its manifest, and what stays Banda's. Roma tried
two mocks (`artifacts/pane-header/pane-header-v1.html` and `-v2.html` in
the brand workspace) and chose:

- Of three ways into the menu (`⋯` by the close button, the title as the
  menu, a layout button with pictures), the layout button.
- A double click on the header makes the column the whole screen wide.
- Of four ways to show the buttons on the right (as before, always, a
  capsule, a capsule only with the focus), the capsule: the buttons in a
  Thread's header, which has no line under it (ADR 0031, decision 8),
  hung in the air.
- The Space stays where each header shows it now. Roma's idea, for its
  own ADR: workspaces by Space, with the Space's icon by its number.

## Decision

1. **Banda draws every Pane's header; an App says what goes in it.** Left
   to right:
   - its **name**: the icon, or the mark of the thing it shows (ADR
     0031), the Space where it is shown now, the title and the quieter
     detail (`title`, `detail`, `label`);
   - the App's **words and choices**, as the Diff's scope and counts or
     the browser's address: what the Pane shows, beside its name;
   - the **capsule**, at the right end.
2. **The capsule holds every button on the right**, in one rounded,
   quiet plate: the App's icon buttons, a line, then Banda's, the Pane
   menu's button and close. It shows on every Pane, faint while the Pane
   has no focus, clearer with the focus or under the pointer; nothing in
   it appears or moves. The App's buttons come first and Banda's always
   end it, in the same place on every Pane.

   *Amended 2026-11-05, after the step 1 trial (Roma's call):* no plate.
   It drew the eye to the header's end more than the buttons it held.
   The buttons stay: always shown, faint without the focus, with the
   line between the App's and Banda's. "The capsule" below names these
   buttons at the header's end.

3. **The Pane menu** opens from the capsule's button (a layout icon), or
   where the pointer is on a right click on the header. Each row runs an
   action that a key runs (ADR 0005, decision 2), and shows that key as
   `keys.toml` binds it:
   - **Width**: the look's `[columns] presets` as pictures of a column on
     the screen, the column's own lit. Pointing at one draws where the
     column would end, in the focus colour, before it is chosen. A step
     the column's `min` draws as wide as a wider one is passed over, as
     `Alt+R` passes it.
   - **Height in its column**: the look's `heights`, so, when the column
     stacks more than one Pane.
   - **Full width** (`Alt+F`), **Zoom** (`Alt+Shift+F`), **Center**
     (`Alt+C`), **the column as a Deck** or stacked again (`Alt+T`, ADR
     0065). A Group's rows join when ADR 0065 builds its actions.
   - **Into the column on the left or right**, or out of its own
     (`Alt+[`, `Alt+]`); **to a workspace**: its numbers, and a new one.
   - **In its own window**, or back, where the window has windows.
   - The App's own actions, then **Close** (`Alt+W`).
   Two actions are new, run by their id with the step as an arg:
   `column.width` (`{ width: "1/2" }`) and `pane.height`
   (`{ height: "1/3" }`). The Banda menu and the key sheet leave them out.
4. **The header answers the mouse as a window's title bar does.** A
   double click makes the column the whole screen wide and back, as a
   double click on the gap does (ADR 0025, decision 5); a middle click
   closes the Pane, as a tab's does; a right click opens the Pane menu.
   Dragging it moves the Pane, as before.
   - _Changed on 2026-11-06, by ADR 0075._ On a Thread's Pane, a click
     on the title opens the Thread menu and a double click on it renames
     the Thread. A double click on the rest of the header is as above.
5. **The pop-out button goes.** "In its own window" is a row of the Pane
   menu. In its own window a Pane has no tiling, so its capsule holds,
   in the menu's place, the button that brings it back.
6. **What an App passes for its header is data, in its manifest** (the
   App SDK, ADR 0062, proposed): `header: { line, middle, Toolbar, menu }`.
   - `line: false` for no line under it, as a Thread's.
   - `middle: "app"` gives the App the room of the words and choices, as
     the browser's tabs and address; Banda then shows only the icon.
   - `Toolbar` holds its words, choices and icon buttons; Banda puts the
     icon buttons in the capsule and the rest beside the name. Each item
     says how long it `keep`s its place: on a narrow Pane the lowest go
     first into a `⋯`, the App's last button in the capsule, then the
     detail. Banda's buttons never go.
   - `menu`: action ids that the Pane menu lists above Close.
   - `header: false` goes, and with it `InHeader`; the frame's
     `TileHeader` stays Banda's.
7. **The Space in the header stays as it is**: before a Thread's title,
   after any other's while the workspace mixes Spaces (ADR 0005,
   decision 7). Grouping workspaces by Space waits for its own ADR.

## Consequences

- ADR 0025, decision 9: the header's menu is built, and the pop-out
  button leaves.
- ADR 0005, decision 1: every tiling action has a mouse path.
- ADR 0031, decision 8: a Thread's header keeps no line; its details
  button is the capsule's first.
- ADR 0065: the menu names the Deck, and shows whichever key runs it.
- `GLOSSARY.md`: the Pane menu.
- Steps, one PR each:
  1. The capsule, the Pane menu with its preview, the header's double,
     middle and right clicks, `column.width` and `pane.height`, the
     pop-out button gone (this ADR's PR). A Pane that draws its own header
     gets the capsule and the menu through `PaneHeader`, its buttons left
     where they are.
  2. `header` in the manifest, `Toolbar` with `keep` and the `⋯`; the
     Diff, Usage and the settings stop drawing their own header.
  3. The browser's tabs and address as its `middle`.
