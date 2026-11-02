import { expect, test } from "vitest"
import { dressed } from "./page"

const PUT =
  /^<meta charset="utf-8"><meta name="viewport"[^>]*><style id="banda-base">[^<]*<\/style><script>/

/** What `dressed` put in, and what is around it. */
function split(html: string): [string, string, string] {
  const at = html.indexOf('<meta charset="utf-8">')
  const end = html.indexOf("</script>", at) + "</script>".length
  return [html.slice(0, at), html.slice(at, end), html.slice(end)]
}

test("Banda's sheet and script go first in the page's head", () => {
  const page =
    '<!doctype html><html lang="en"><head class="x"><style>p{}</style></head><body><p>Hi</p></body></html>'
  const [before, put, after] = split(dressed(page))
  expect(before).toBe('<!doctype html><html lang="en"><head class="x">')
  expect(put).toMatch(PUT)
  expect(after).toBe("<style>p{}</style></head><body><p>Hi</p></body></html>")
})

test("a page with no head takes them after its root, its doctype, or first", () => {
  expect(split(dressed("<html><body>Hi</body></html>"))[0]).toBe("<html>")
  expect(split(dressed("<!DOCTYPE html>\n<p>Hi</p>"))[0]).toBe(
    "<!DOCTYPE html>"
  )
  expect(split(dressed("<p>Hi</p>"))[0]).toBe("")
  // A <header> is not the head.
  expect(split(dressed("<header>Top</header>"))[0]).toBe("")
})

test("the script Banda puts in is a script, and names the frame's words", () => {
  const [, put] = split(dressed("<p>Hi</p>"))
  const script = put.slice(put.indexOf("<script>") + 8, -"</script>".length)
  expect(() => new Function(script)).not.toThrow()
  expect(script).toContain("ui/notifications/size-changed")
  expect(script).toContain("ui/notifications/host-context-changed")
  expect(script).toContain("ui/open-link")
  expect(script).toContain("banda-look=")
})
