import type { ProjectSummary } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { NOT_TRUSTED, ProjectSign, UNTRUSTED } from "./project-sign"

const project: ProjectSummary = {
  id: "one",
  name: "widget",
  folder: "/code/widget",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "W", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
}

const drawn = (one: ProjectSummary | undefined) =>
  renderToStaticMarkup(<ProjectSign project={one} className="mine" />)

test("a trusted Project's sign is its tile alone", () => {
  const html = drawn(project)
  expect(html).not.toContain("data-untrusted")
  expect(html).not.toContain("mask-image")
  expect(html).toMatch(/^<span[^>]*data-sign="letters"[^>]*class="[^"]*mine/)
})

test("a Project not trusted wears a grey dashed circle at its sign's corner, never a state's colour", () => {
  const html = drawn({ ...project, trusted: false })
  expect(html).toMatch(/^<span data-untrusted=""/)
  expect(html).toContain(`title="${UNTRUSTED}"`)
  // A screen reader hears it, as the circle is only drawn.
  expect(html).toContain(`<span class="sr-only">${NOT_TRUSTED}</span>`)
  expect(html).toContain("lucide-circle-dashed")
  expect(html).toContain("text-muted-foreground")
  expect(html).not.toMatch(/text-(attention|destructive|primary)/)
  // The tile gives its corner to the circle, and the wrapper takes what
  // the place gave the sign.
  expect(html).toContain("mask-image:radial-gradient")
  expect(html).toMatch(/data-untrusted=""[^>]*class="[^"]*mine/)
})

test("No Project's dashed tile wears no corner", () => {
  expect(drawn(undefined)).not.toContain("data-untrusted")
  expect(drawn({ ...project, scratch: true, trusted: false })).not.toContain(
    "data-untrusted"
  )
})
