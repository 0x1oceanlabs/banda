import { expect, test } from "vitest"
import { comboOf, hidden } from "./hands"

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

test("a press is its key and the modifiers held, and a modifier Playwright has not is refused", () => {
  expect(comboOf("Shift++")).toEqual({ key: "+", held: ["Shift"] })
  expect(comboOf("+")).toEqual({ key: "+", held: [] })
  expect(comboOf("ControlOrMeta+Shift+a")).toEqual({
    key: "a",
    held: ["ControlOrMeta", "Shift"],
  })
  for (const combo of ["Ctrl+W", "Cmd+L", "a+"])
    expect(() => comboOf(combo)).toThrow("is not a modifier")
})
