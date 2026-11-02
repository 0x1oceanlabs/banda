---
name: browser
description: Banda's browser - its tabs on top or on the left, its search, its keys, how an Agent drives it over CDP - and ~/.config/banda/browser.toml.
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
- `blocker = false`: stops Banda's ad blocker. It is on when left out:
  it drops the requests and hides the elements that EasyList,
  EasyPrivacy and uBlock Origin's lists name, in every browser Pane. The
  lists are fetched once a day and kept in `blocker.bin` in the window's
  folder.

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
gives does not run. uBlock Origin Lite blocks nothing here, as Electron
has no `declarativeNetRequest`; the built-in blocker does that job.

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

## An Agent drives it

Every Agent on this machine reaches the browser's tabs through one CDP
endpoint. It looks like a whole Chrome whose targets are the tabs and
nothing else, never Banda's own page. `banda browser` prints it while
Banda's window is open, `http://127.0.0.1:<port>/<token>`, and
`banda browser --web-socket` the browser's WebSocket; both exit 2 when
the window is not open. Hand it to a tool that speaks CDP:

```sh
npx @playwright/mcp --cdp-endpoint "$(banda browser)"
npx chrome-devtools-mcp --browser-url "$(banda browser)"
```

```js
const browser = await chromium.connectOverCDP(endpoint)
const [context] = browser.contexts()
const tabs = context.pages()
```

- The pages are the Person's tabs, signed in as the Person is: do there
  what the Person asked, and nothing more.
- `context.newPage()` opens a tab in the browser Pane in front, or with
  no browser Pane a new one beside the Person's; neither takes the
  Person's focus. Closing the page closes the tab. There is one profile:
  `browser.newContext()` is refused.
- `browser.close()` only leaves: Banda and its tabs stay.
- A tab you drive shows your mark, and keeps drawing when the Person
  looks at another. A click on it stops you there: your sessions on that
  tab end (`Target.detachedFromTarget`, and Playwright's page closes).
  Do not attach to it again unless the Person asks you to.
- Downloads still go to `~/Downloads`, and a site that asks for the
  camera or the location still asks the Person.
- Whoever has the token drives the browser. It changes each time the
  window starts, and only the Person can read the file it is in,
  `browser.json` in Banda's state folder. Pages on the web cannot reach
  it.
- DevTools opened on a tab (`F12`) ends the Agents' sessions on it.
