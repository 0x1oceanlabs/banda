---
name: browser
description: Banda's browser - its tabs on top or on the left, its search, its keys - and ~/.config/banda/browser.toml.
---

# The browser

A browser Pane is Chromium in a tile, with one profile for every Pane:
the Person's sign-ins, cookies, extensions and downloads are the same in
each. Its row shows its tabs, back, forward and reload, the address, the
extensions, the downloads while there are any, and the switch.

`~/.config/banda/browser.toml` sets where the tabs are and where words
typed in the address go. The switch in the row writes `tabs` into it and
keeps everything else; every browser Pane follows. If the file is not
there yet, it starts as this template:

<!-- include ../browser.toml -->

- `tabs = "top"`: the tabs at the start of the row, as Helium's compact
  layout.
- `tabs = "left"`: a narrow rail of the sites' icons beside the page; it
  opens to their titles while the pointer rests on it.
- `search`: an `http` or `https` address with `%s` where the words go,
  as `"https://kagi.com/search?q=%s"`. DuckDuckGo when it is left out.
- `pinned`: the IDs of the extensions whose buttons sit in the row, in
  order, as `["ddkjiahejlhfcafbddmgiahcphecmpfh"]`. The pin in the
  Extensions menu writes it.

`banda settings check ~/.config/banda/browser.toml` names a wrong key or
value and its line.

## Extensions

Chrome's extensions come from the Chrome Web Store: the Extensions
button's menu opens it in a tab, and its "Add to Chrome" asks the Person
first, naming what the extension may read. They live in `Extensions/`
in the window's folder, `~/.config/@banda/desktop/` unless `BANDA_STATE`
moves it, and update themselves. The
same menu lists them: a row clicks the extension's button, its pin puts
the button in the row, its cross removes it. A button opens its popup
under itself; Escape, a click elsewhere or another tab closes it. A
page's right-click menu has the extensions' items under Chrome's own.
Most of Chrome's extension APIs work; one that needs more than Electron
gives does not run.

## Keys

Banda's Alt keys work in a page as anywhere: `Alt+Shift+Return` opens a
new browser, `Alt+W` closes the Pane. The browser's own are Chrome's,
with Ctrl:

| Keys | What they do |
|---|---|
| `Ctrl+T` | a new tab |
| `Ctrl+W` | close the tab; the last one closes the Pane |
| `Ctrl+Shift+T` | open the tab closed last again |
| `Ctrl+Tab`, `Ctrl+Shift+Tab` | the next or the previous tab |
| `Ctrl+1…8`, `Ctrl+9` | the tab at that place, or the last one |
| `Ctrl+L` | the address |
| `Ctrl+R`, `Ctrl+Shift+R` | reload, or reload past the cache |
| `Ctrl+[`, `Ctrl+]` | back and forward |
| `Ctrl+=`, `Ctrl+-`, `Ctrl+0` | zoom |
| `F12` | the page's DevTools |

A link that opens a new tab opens one beside its page; with Ctrl or the
middle button it opens behind it. Downloads go to `~/Downloads`.
