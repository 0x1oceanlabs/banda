---
status: accepted
date: 2026-11-05
---

# The sidebar's foot holds the settings, the keys, the theme and the view

The sidebar's header held a Search field and three icons: the view menu,
a new Space and a new Thread (ADR 0017, decision 3). Its foot held one
button, "Settings" with its gear, under a line, and another line ran over
the shelves. It was always 16rem wide.

Roma, on 2026-11-05: let the sidebar's width change, take the lines out,
make the settings a gear alone, and think what else goes beside it. Roma
tried a mock (`artifacts/sidebar-width/sidebar.html` in the brand
workspace) with neighbours to pick from, took the width as it was shown
(PR #571), and then chose for the foot: no button to hide the sidebar, as
Alt+A and the edge hide it; the key sheet, the theme, and the view menu
and "Add Space" moved down from the header.

## Decision

1. **The sidebar's right edge drags its width** (PR #571).
   - From 13rem to 32rem, a quarter rem a step, and never so wide that
     no column `min` fits beside it. Near 16rem it sticks; a double click
     puts 16rem back; Esc while dragging puts it back as it was.
   - Dragged past the narrowest, letting go hides the sidebar, and Alt+A
     brings it back as wide as it was.
   - On the keyboard, the edge is a separator: ← and → a rem, with Shift
     four, Home, End, and Enter for 16rem.
   - The window keeps the width, in rem, beside whether the sidebar
     shows; a narrow window (ADR 0025, decision 10) counts the width.
2. **No lines in the sidebar.** Where more Threads are below than show,
   the list fades out at its foot.
3. **The header holds the Search field and "New Thread".**
4. **The foot holds five icons, with no words**, each named in its
   tooltip with its key:
   - **Settings** (`Alt+,`, ADR 0016);
   - **Every action and its key** (`Alt+K`), the key sheet;
   - **Theme**, a menu: light, dark or as the system, where the theme
     has both, and otherwise says which one it has; then every theme,
     `banda` and `omarchy` first. It writes look.toml's `mode` and
     `theme`, as Appearance does (ADR 0007, decision 4);
   - **View**, the view menu (ADR 0008), unchanged but for where it is;
   - **Add Space** (ADR 0026).
5. **No button hides the sidebar.** Alt+A does, and the edge dragged
   past the narrowest.

## Consequences

- ADR 0017, decision 3: the view menu and "Add Space" leave the header
  for the foot.
- ADR 0008: the view menu is in the foot, not the header.
- ADR 0016: the gear is one of the foot's icons. The theme menu writes
  look.toml through `banda settings`, as the settings do.
