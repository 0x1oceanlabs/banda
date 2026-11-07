import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Markdown } from "./markdown"
import { MarkdownLinks, webLink } from "./markdown-link"

const draw = (text: string) =>
  renderToStaticMarkup(
    <MarkdownLinks open={() => {}}>
      <Markdown>{text}</Markdown>
    </MarkdownLinks>
  )

test("web links retain the full destination and explain both ways to open", () => {
  const url = "https://github.com/0x1oceanlabs/banda/issues/493?q=one#comment"
  const html = draw(`[Issue **493**](${url})`)
  expect(html).toContain(`href="${url}"`)
  expect(html).toContain('data-streamdown="strong">493</span>')
  expect(html).toContain("(github.com)")
  expect(html).toContain("Ctrl+click")
  expect(html).toContain("Click to open in Banda")
  const bare = draw(url)
  expect(bare).toContain(`href="${url}"`)
  expect(bare).toContain("truncate")
  expect(bare).not.toContain("(github.com)")
})

test("only absolute HTTP(S) links enter web navigation", () => {
  for (const url of [
    "https://example.com/a",
    "http://localhost:3000/a",
    "HTTPS://EXAMPLE.COM/",
  ])
    expect(webLink(url)).not.toBeNull()
  for (const url of [
    undefined,
    "https://",
    "/tmp/readme.md",
    "../file.md",
    "//example.com",
    "file:///tmp/file.md",
    "javascript:alert(1)",
    "mailto:a@example.com",
  ])
    expect(webLink(url)).toBeNull()
  const local = draw("[File](/tmp/readme.md)")
  expect(local).not.toContain("Ctrl+click")
  expect(draw("[bad](javascript:alert%281%29)")).not.toContain(
    'href="javascript:'
  )
})

test("a reply's notes are its own, under their label, and never open a window (ADR 0063)", () => {
  const note = "A claim[^one].\n\n[^one]: The note."
  const html = renderToStaticMarkup(
    <>
      <Markdown>{note}</Markdown>
      <Markdown>{note}</Markdown>
    </>
  )
  const scopes = [...html.matchAll(/href="#(\S+?)fn-one"/g)].map(
    ([, scope]) => {
      expect(html).toContain(`id="${scope}fnref-one"`)
      expect(html).toContain(`id="${scope}fn-one"`)
      expect(html).toContain(`href="#${scope}fnref-one"`)
      return scope
    }
  )
  expect(new Set(scopes).size).toBe(2)
  expect(html.match(/<h2[^>]*>Notes<\/h2>/g)).toHaveLength(2)
  expect(html).not.toContain("sr-only")
  expect(html).not.toMatch(/href="#[^"]*"[^>]*target=/)
})
