import { expect, test } from "vitest"
import { hidden, onWeb, pressOf, ruleAt, siteAt, stepOf } from "./hands"

test("secret values are hidden across roles without changing refs, names or metadata", () => {
  const tree = `- textbox "CVV" [ref=e2]: "2"
- spinbutton "Card: number" [ref=e12]: "246813579"
- iframe [ref=e3]:
  - textbox "Frame card" [ref=f1e2]: "112233445"
- textbox "Notes" [ref=e4]: "text"
- heading "2" [ref=e5] [level=2]
- textbox "Bracketed" [ref=e6]: "[ref=e2]"`
  expect(hidden(tree, ["246813579", "112233445", "text", "2"]))
    .toBe(`- textbox "CVV" [ref=e2]: "••••"
- spinbutton "Card: number" [ref=e12]: "••••"
- iframe [ref=e3]:
  - textbox "Frame card" [ref=f1e2]: "••••"
- textbox "Notes" [ref=e4]: "••••"
- heading "2" [ref=e5] [level=2]
- textbox "Bracketed" [ref=e6]: "[ref=e••••]"`)
})

const tree = `- generic [ref=e1]:
  - button "Greet" [ref=e2]
  - textbox "Name" [ref=e20]: Roma
  - link "${"a very long link that goes on and on and on"}" [ref=e3]`

test("a step names its elements as the last snapshot does, and says no text typed", () => {
  const act = (more: object) => stepOf(tree, { tab: 1, ...more } as never)
  expect(act({ action: "click", ref: "e2" })).toBe('Clicking "Greet"')
  expect(act({ action: "fill", ref: "e20", text: "secret" })).toBe(
    'Typing in "Name"'
  )
  expect(act({ action: "hover", ref: "e3" })).toBe(
    'Pointing at "a very long link that goes on and on an…"'
  )
  expect(act({ action: "drag", ref: "e2", to: "e20" })).toBe(
    'Dragging "Greet" to "Name"'
  )
  expect(act({ action: "press", key: "Enter" })).toBe("Pressing Enter")
  expect(act({ action: "scroll" })).toBe("Scrolling down")
  // A ref no snapshot named is said as it is.
  expect(act({ action: "click", ref: "e9" })).toBe("Clicking e9")
  expect(stepOf(tree, { tab: 1, text: "Done" })).toBe('Waiting for "Done"')
  expect(stepOf(tree, { tab: 1, url: "/next" })).toBe("Waiting for /next")
})

test("a site is its page's domain, and this computer's own pages none", () => {
  const site = (url: string) => siteAt(url)?.site
  expect(siteAt("https://gist.github.com/x")).toEqual({
    host: "gist.github.com",
    site: "github.com",
  })
  expect(site("https://a.b.co.uk")).toBe("b.co.uk")
  expect(site("https://roma.github.io/")).toBe("roma.github.io")
  expect(site("http://192.168.1.2:8080/")).toBe("192.168.1.2")
  expect(site("http://[fe80::1]/")).toBe("[fe80::1]")
  expect(site("http://site.localhost:5173/")).toBe("site.localhost")
  for (const own of [
    "http://localhost:5173/",
    "http://127.0.0.1/",
    "http://[::1]:3000/",
    "about:blank",
    "file:///home/roma/notes.html",
    "not an address",
  ])
    expect(siteAt(own)).toBeNull()
})

test("a rule is the host's, or the nearest domain's above it up to the site", () => {
  const rules = { "github.com": "allow", "gist.github.com": "deny" }
  const at = (url: string) => ruleAt(rules, siteAt(url)!)
  expect(at("https://gist.github.com/")).toBe("deny")
  expect(at("https://a.gist.github.com/")).toBe("deny")
  expect(at("https://api.github.com/")).toBe("allow")
  expect(at("https://github.com/")).toBe("allow")
  expect(at("https://gitlab.com/")).toBeUndefined()
  // Above the site is another site's.
  expect(
    ruleAt({ "co.uk": "allow" }, siteAt("https://b.co.uk/")!)
  ).toBeUndefined()
  expect(at("http://[fe80::1]/")).toBeUndefined()
})

test("a page on the web is at an http or https address, or blank", () => {
  expect(onWeb("https://mail.example.com/inbox")).toBe(true)
  expect(onWeb("http://localhost:5173/")).toBe(true)
  expect(onWeb("about:blank")).toBe(true)
  for (const url of [
    "file:///home/person/notes.txt",
    "chrome-extension://abc/popup.html",
    "devtools://devtools/bundled/inspector.html",
    "data:text/html,hi",
    "",
  ])
    expect(onWeb(url), url).toBe(false)
})

test("a press is Electron's key for Playwright's names, and a modifier it has not is refused", () => {
  expect(pressOf("Shift++")).toEqual({
    down: { type: "keyDown", keyCode: "+", modifiers: ["shift"] },
    char: true,
  })
  expect(pressOf("+").down.modifiers).toEqual([])
  expect(pressOf("Control+ArrowDown")).toEqual({
    down: { type: "keyDown", keyCode: "Down", modifiers: ["control"] },
    char: false,
  })
  expect(pressOf("Enter").char).toBe(true)
  for (const combo of ["Ctrl+W", "Cmd+L", "a+"])
    expect(() => pressOf(combo)).toThrow("is not a modifier")
})
