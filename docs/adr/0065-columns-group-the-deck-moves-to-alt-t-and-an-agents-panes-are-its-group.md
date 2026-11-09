---
status: accepted
date: 2026-11-05
---

# Columns group, the Deck moves to Alt+T, and an Agent's Panes are its Group

Roma works with about ten Agents at once, from the flat Inbox, where
Threads of every Space are mixed. Today a click on a Thread goes to
wherever its Pane happens to be (ADR 0005, decision 8). The Panes an
Agent opens (a browser, files, Git, a diff) land as new columns with
nothing tying them to their Thread. After a while, a Thread and its
Panes are scattered across the Strip, and the Person has to find them
again each time.

Roma's mockups of 2026-11-04 (`agent-v1.html`) settled the direction:
an Agent and its Panes stay together, and a picked Agent always comes
to the same place, at the left, beside the sidebar. On 2026-11-05 Roma
renamed the parts. What ADR 0005 calls a column's group, its Panes as
tabs on `Alt+G`, is now a **Deck**, on `Alt+T`. A **Group** is now several
columns held together, so they move as one and look as one. That works
for any Panes, and an Agent's Panes are simply its Group.

## Decision

1. **A Deck is a column that shows one Pane at a time, on `Alt+T`.**
   - A column shows its Panes stacked or as a Deck: one Pane shown, the
     others' names in a row over it, as now (ADR 0005, decision 5;
     `[columns] display` in `look.toml`, ADR 0007).
   - The word is new, as Roma asked on 2026-11-05, because "Tab" is already a browser page's
     (glossary), and a browser Pane in a Deck would show both. A Deck
     is a pile of cards with one on top; the row over it shows each
     card's name.
   - `Alt+T` switches it, and `Alt+G` is freed for Groups. The action
     keeps its id, `column.tabs`, so a `keys.toml` that names it keeps
     working; `display = "tabs"` is still read, as `"deck"`. A
     `keys.toml` that binds `Alt+G` itself still wins.
   - Sonner's own `Alt+T` stays off (ADR 0048), so the key is free.

2. **A Group is adjacent columns of one workspace, held together.**
   - The nesting is Pane, column, Group, workspace. A Group holds one
     column or more, side by side, with no ungrouped column between
     them. A column is in one Group at most. Groups don't nest.
   - A Group is layout only. It holds Panes of any Space, as a workspace
     does, and it gives no access: ADR 0032 still decides what an Agent
     sees.
   - `Alt+G` starts a Group of the focused column alone, and Panes are
     added to it after. A Group lasts while it holds a column; taking
     out its last one ends it.
   - The engine keeps it with the arrangement (ADR 0025): a column
     names its Group. There are new commands to group, to ungroup, and
     to move a Group, and the events carry the whole arrangement, as
     now.

3. **A Group moves as one.**
   - Moving any of its columns sideways moves the whole Group past its
     neighbour. This is what Roma asked for: the Panes go where the
     Group goes.
   - An ungrouped column moved sideways passes a Group whole. It doesn't
     enter the Group by accident.
   - Moving a grouped Pane to another workspace (`Alt+Shift+1…9`, or a
     drag) takes its whole Group there, as one window. To move one Pane
     alone, it first leaves its Group (`Alt+Shift+[` or `]`).
   - Focus crosses a Group's edges as it crosses columns now. A Group
     doesn't trap the arrows.
   - _Changed 2026-11-06._ The mouse's way to move a Group whole is the
     mod (ADR 0068, `Alt` by default) held while dragging any of its
     Panes by its header, or from anywhere on it, as the mod drags a
     Pane: the Group lands as its handle's drag lands it, along the
     Strip, on another workspace or in the overview. Without the mod the
     Pane goes alone, and dropped on another workspace it leaves its
     Group. The mod pressed or let go during the drag switches between
     the two. While a grouped Pane is carried, a note under its name says
     "Hold Alt to move the whole Group", or "Moving the whole Group",
     and the Group's columns look lifted with it. Roma approved it on
     2026-11-06.

4. **The keys follow niri's families, one level up** (as ADR 0005,
   decision 10):

   | Keys | Action |
   |---|---|
   | `Alt+T` | the column as a Deck, and back (was `Alt+G`) |
   | `Alt+G` | a new Group of the focused column. It only creates; a column already in a Group stays where it is |
   | `Alt+Shift+[`, `Alt+Shift+]` | an ungrouped column joins the Group on that side. A grouped column leaves its Group toward that side. This mirrors what `Alt+[` and `Alt+]` do for a Pane and a column |
   | `Alt+Shift+←`, `Alt+Shift+→` | in a Group, move the whole Group one place that way. Otherwise, the column, as now |
   | `Alt+Ctrl+Shift+←`, `Alt+Ctrl+Shift+→` | move the column inside its Group |
   | `Alt+Shift+Home`, `Alt+Shift+End` | the Group, or the column, to the first or last place |
   | `Alt+M` | the whole Group the screen wide, its columns keeping their shares, and back. `Alt+F` still widens the column alone |
   | `Alt+Shift+1…9` | in a Group, move the whole Group to workspace N. Otherwise, the Pane, as now |

   - `Alt+[` and `Alt+]` keep their meaning: a Pane goes into or out of
     a column. Inside a Group, a Pane taken out of a column gets its own
     column in the same Group.
   - Every action is in the Banda menu and `keys.toml` (ADR 0017), as
     `group.new`, `group.join-left`, `group.join-right`,
     `group.column-left`, `group.column-right` and `group.maximize`.
     The moves are the Pane's own actions (`pane.move-left`,
     `column.move-first`, `pane.send-N` and the rest), which take a
     Group whole (_built_ 2026-11-05, step 2).

5. **The mouse does the same.**
   - Dragging a column's header inside the outline reorders it in the
     Group. Dropping it outside the outline takes it out.
   - Dropping a Pane or a column inside a Group's outline puts it in,
     between the columns where it falls.
   - Dragging the Group's handle (decision 6) moves the whole Group:
     along the Strip, to another workspace, or in the overview.
   - _Changed on 2026-11-06._ The handle is off by default (decision
     6), and it is the mouse's one way to move a Group whole: a grouped
     Pane dragged by its header goes alone, and dropped on another
     workspace it leaves its Group. Without the handle, the keys move a
     Group (decision 4).
   - _Changed again on 2026-11-06._ The mod and a drag of any of its
     Panes move a Group whole too, with or without the handle (decision
     3).

6. **A Group reads as one thing, by a plate or a halo, coloured by
   its Agent's state.**
   - Two looks, as `[groups] look = "plate" | "halo"` in `look.toml`.
     Roma chose both on 2026-11-05 (mockup `group-looks-2.html`).
   - _Changed on 2026-11-06._ The halo is dropped, and the plate is a
     Group's one look; a `look` in `[groups]` is still read, and let go.
     The Strip clips what passes its edge, and with only `gap-outer`
     round a Group there the halo's blur was cut off, so it read as a
     coloured focus ring.
   - **Plate** (the default): one rounded rectangle behind the Group's
     tiles, the same margin on every side. Its radius is the tile's
     radius plus that margin, the same shape as the overview's plate
     (ADR 0052). Solid look: a little of the state's colour mixed into
     the desk (`color-mix`, about 9%) and a 1px hairline at about 25%.
     Glass look: the tiles' frosted material, one step clearer, so the
     tiles float over it, with the hairline catching the light at the
     top edge. No drop shadow and no second blur layer.
   - **Halo**: a soft glow of the state's colour under the Group, with
     no line. It is at its best in glass. In the solid look a faint
     hairline is added, so the edge isn't lost.
   - Inside a Group, the gaps between columns stay `gap-inner`. Between
     a Group and its neighbours the gap is `gap-outer`, so the edge
     shows by the spacing alone.
   - **The colour is the Agent's state**, the same colours the Inbox
     and the bar use:
     - working: blue, breathing slowly (_changed_ in step 3: a light
       running along the plate's top edge ran apart in each column's
       piece).
     - waiting for the Person: amber. It brightens twice, then stays.
     - done: green, until the Person opens the Thread, as an unread
       mark.
     - idle, or a Group with no Agent: neutral, barely there.
     The motion follows the look's motion and reduced-motion choices.
   - _Changed on 2026-11-06._ The states stand on a ladder, quiet to
     loud, fill and line: none 4% and 9%, working 7% and 18%, done 10%
     and 30%, failed 10% and 36%, asking 13% and 48%. The focused Group
     adds 2% and 18% in its own colour. A change of state crossfades
     over 0.6s. Done, failed and a call swell as they come, and only
     then: not for a plate first drawn in its state. `[groups]` in
     `look.toml` chooses the motion: `working = "breath"` (the default:
     the fill breathes), `"line"`, `"sheen"` (a band of light across
     the whole Group) or `"still"`; `asking = "twice"` (the default:
     two swells, then still) or `"pulse"` (then a slow pulse until
     answered); `saturation = "soft" | "normal" | "vivid"`, every fill
     and line quieter or louder (`"normal"` the default). Roma chose
     them on 2026-11-06 (mockup `plate-states.html`). `[motion] off`
     and reduced motion still it all; the colours stay.
   - **No label above the Group.** The Thread is always the Group's
     first column, and its header already names the Agent. The state is
     a chip on the right of the Thread's header, in the system zone of
     the Pane header.
   - **A handle shows under the pointer**, on every Group: a small pill
     on the Group's top edge, with its name and number of Panes. It is
     what a drag holds (decision 5). `[groups] handle = false` in
     `look.toml` turns it off. Roma isn't sure it will be wanted, so the
     default may change after real use.
   - _Changed on 2026-11-06._ Roma turned it off by default:
     `[groups] handle = true` brings it back.
   - The Group that holds the focused Pane is a little brighter. Other
     Groups stay quiet. The focused Pane's own frame is unchanged.
   - The overview and the bar's map draw the Groups in the same colours.

7. **An Agent's Panes are its Group.**
   - The Thread's column comes first. A Pane the Agent opens joins its
     Group, to the right. Those Panes come as one Deck by
     default, so the Group stays two columns wide: the Thread, and a Deck
     of its browser, files, Git and diff.
   - The Person takes a Pane out (`Alt+Shift+[` or `]`, or a drag) or puts one in, as with any Group. A Pane the Person
     puts in does not give the Agent access to it (decision 2).
   - The Group shows the Agent's state by colour (decision 6). An Agent
     has no colour of its own: when ten of them run, which one waits
     matters more than which one is which, and the Thread's header
     names it.
   - When the Thread's Pane closes, its other Panes stay together as a
     neutral Group.
   - _Changed on 2026-11-06._ The Thread is a Group from its opening,
     not from the first Pane its Agent opens: its plate is there at once,
     and nothing jumps when the Group's pads come. Opened in the window
     in any way (a pick, a New Thread, on its Project's workspace or
     beside the Pane in front), its column starts a Group of its own,
     unless it opens into a Group, whose member it stays. Only at its
     opening: a Thread the Person takes out of its Group, or one kept
     from before in none, stays in none until it opens again. Its kind
     says so (`PaneKind.grouped`), and the window opens it `grouped`;
     the engine knows no kind.
   - _Changed on 2026-11-09._ The engine knows the kind too. The
     window's tests copy `PaneKind.grouped` into its App's
     `window.json`, and the engine reads it as it starts and gives the
     workspaces those kinds. So a Thread is a Group from its opening,
     whoever opens it: the window, an Agent's `open_pane` or the CLI.
     `workspaces.open` with `grouped` left out does as the kind says;
     `false` keeps it out. The window still sends `grouped`, so its
     copy of the model needs no kinds. A Thread an Agent puts into
     another Pane's column makes no Group of it.
   - _Changed on 2026-11-09._ A Pane an Agent opens with its tool and
     no place goes into its Thread's Group, as a Diff opened from the
     Thread does: last into the Deck right of the Thread, or into a new
     Deck there. The engine knows the Thread from the Agent's pass (ADR
     0083, decision 2). With the Thread on no workspace, the Pane goes
     where a Pane with no place goes. A Thread in no Group, taken out by
     the Person or kept from before, starts one for it, as it does for
     that Diff. A Thread an Agent opens starts a Group of its own and
     never joins the opener's.

8. **A picked Agent comes to the left.**
   - A pick from the Inbox, the bar's widget or `Alt+U` (go to what
     calls you, ADR 0005) brings the Agent's Group to the left edge of
     the Strip, beside the sidebar, and focuses its Thread. Every Agent
     comes to the same place.
   - The Strip scrolls, so the Group lands at the left. The other
     columns don't move.
   - The Inbox rows don't reorder under the pointer. New calls collect
     in an "↑ N updates" pill until the pointer leaves the list.

9. **Each Space's Agents sit on one workspace** (`[agents] workspaces =
   "space"`, the default; `"off"` keeps today's behaviour).
   - A Thread of a Space opens on that Space's workspace, in a row with
     the Space's other Agents' Groups, as niri's Strip. Scrolling the
     row shows what each of them is doing.
   - A pick from another Space swaps the workspace in place: that
     Space's workspace comes, with no slide from above or below, and
     the Group lands at the left.
   - Any workspace still holds Panes of any Space (glossary, Workspace).
     A Space's workspace is only where its Agents open. "Desk" stays a
     word to avoid; in speech, Roma's "стол" is the Space's workspace.
   - The bar shows each such workspace as its Space's badge, with a dot
     while one of its Agents calls, and a small map of the current
     workspace's Groups.
     _Changed on 2026-11-09:_ Roma found the dot and the map noisy. A
     Project's workspace shows its sign alone, with no dot for a call,
     and the map is gone. What calls is the sidebar's and the toasts'.
   - With the sidebar hidden, the bar's agents widget is the switcher.
     It shows the current Agent and the counts, opens the same list as
     the Inbox, and new calls come as toasts (ADR 0048).
     _Changed by ADR 0087, decision 8: the list goes in the sidebar's
     order._

## Out of scope

- "Recent" (most recently used first) and "Wall" (every Agent in a
  grid) arrangements. These are later values of `[agents] workspaces`.
- Groups across workspaces, and nested Groups.
- Folding a Group to a slim rail, and Focus, which folds all but the
  current one. The mockup shows both. They come after Groups are in
  real use.
- Sharing a Pane's access through a Group.

## Consequences

- ADR 0005, decision 10: `Alt+G` becomes `Alt+T`, and `Alt+G` is a
  Group's. ADR 0007's `display` note names `Alt+T`.
- ADR 0005, decision 8: a click on a Thread brings its Group to the left
  of its Space's workspace, rather than going wherever its Pane is.
- ADR 0025: a column names its Group, and the `workspaces` module gets
  `group`, `ungroup` and `move_group`.
- GLOSSARY gains **Group** and **Deck**, and Workspace gains a line on a
  Space's workspace.
- The work comes in PRs, in order:
  1. The Deck on `Alt+T`.
  2. Groups in the engine and the window: plate and halo, state colours, handle, keys, mouse.
  3. An Agent's Panes join its Group.
  4. A picked Agent comes to the left; the Inbox holds still under the
     pointer.
  5. Each Space's Agents on one workspace, and the in-place swap.
  6. The bar: Space badges, the map, and the widget as the switcher.

  _Built_ 2026-11-05, all six: #569, #573, #575, #576, #577, #579
  and the bar's.
