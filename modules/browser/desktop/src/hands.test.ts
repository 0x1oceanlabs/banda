import { expect, test } from "vitest"
import { ruleAt, siteAt, stepOf } from "./hands"

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
