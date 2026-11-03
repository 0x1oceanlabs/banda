import { expect, test } from "vitest"
import { domainOf, stepOf } from "./hands"

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
  expect(domainOf("https://gist.github.com/x")).toBe("github.com")
  expect(domainOf("https://a.b.co.uk")).toBe("b.co.uk")
  expect(domainOf("https://roma.github.io/")).toBe("roma.github.io")
  expect(domainOf("http://192.168.1.2:8080/")).toBe("192.168.1.2")
  expect(domainOf("http://site.localhost:5173/")).toBe("site.localhost")
  for (const own of [
    "http://localhost:5173/",
    "http://127.0.0.1/",
    "http://[::1]:3000/",
    "about:blank",
    "file:///home/roma/notes.html",
    "not an address",
  ])
    expect(domainOf(own)).toBeNull()
})
