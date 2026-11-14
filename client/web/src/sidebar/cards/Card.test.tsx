import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Card } from "./Card"

test("the one card draws what it is given: a card that is no row of the list has no data-row, and its buttons stand under its lines, hidden from a screen reader", () => {
  const html = renderToStaticMarkup(
    <Card
      card={{
        stop: "project:p1",
        picked: false,
        name: "Trust “banda”?",
        data: { "data-asks": "trust" },
        lines: [{ left: "Trust “banda”?" }, { left: "Project /code/banda" }],
        buttons: <button type="button">Trust…</button>,
      }}
    />
  )
  expect(html).not.toContain("data-row")
  expect(html).toMatch(/^<div id="[^"]+" role="option"[^>]*data-asks="trust"/)
  expect(html).toContain('aria-label="Trust “banda”?"')
  expect(html).toMatch(
    /Project \/code\/banda<\/span><span aria-hidden="true"[^>]*><button[^>]*>Trust…<\/button><\/span><\/div>$/
  )
  // Two lines: a card's padding, and no acts' room.
  expect(html).toContain("py-1.5")
  expect(html).not.toContain("data-acts")
})
