---
status: accepted
date: 2026-11-02
---

# shadcn on glass is the text's own colour, thinned

shadcn's fills, `muted`, `accent` and `secondary`, are solid greys made for a solid page. The same goes for its quiet text (`muted-foreground`) and its lines (`border`, `input`). On Banda's glass (ADR 0023, ADR 0030) the page under them is a different colour on every wallpaper, so they go wrong two ways:

- On a dark desk, the current workspace's mark and a selected tab are a grey patch stuck on the glass.
- On a light desk, the mark almost vanishes into the wallpaper, so nothing says which workspace is current.

The quiet grey text reads on some wallpapers and not on others. Roma: the small things are what make Banda pleasant to use.

## Decision

1. **On glass, shadcn's fills are the text's own colour, thinned.** `muted`, `accent` and `secondary` are `--foreground` at 10%, the rest clear. A fill takes the colour of the glass under it: lighter on a dark desk, darker on a light one. It shows on any wallpaper and never sits on it as a patch. Hover and selected are the same fill, as they were.
2. **Quiet text is the text's colour at 62%,** not a fixed grey, so it keeps its contrast on any wallpaper.
3. **Lines are the text's colour at 10% (`border`) and 12% (`input`).**
4. **Something current shows by more than its colour:** the fill, the full text colour and a heavier weight, as the current workspace already has.
5. **One place, with the rest of the glass.** The tokens sit in `html[data-glass]` in `globals.css`, beside the desk's, the panel's and the tiles'. They are `!important`: the page sets the theme's colours on the root element itself, which beats any stylesheet otherwise. Every shadcn component follows, and none needs changing. On a solid desk the theme's colours stay as they are. _Changed on 2026-11-06, by ADR 0080:_ the resolver derives the glass tokens, with these values as its defaults, and the `!important` rules go.

## Consequences

- The current workspace, a selected tab, a menu's highlighted row and a key hint all read on any wallpaper, light or dark, tried on four of Omarchy's.
- Tuning a number is one line of CSS.
- A theme's own `muted` and `accent` colours do not show on glass. Its `foreground` still does, and so does its `primary`, which is what a theme's accent colour is for.
