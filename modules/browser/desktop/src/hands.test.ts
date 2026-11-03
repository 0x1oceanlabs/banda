import { expect, test } from "vitest"
import { stepOf } from "./hands"

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
