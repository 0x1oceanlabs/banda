import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import type { Row as Arranged } from "./arrange"
import { Row } from "./Row"
import type { Part, Settings } from "./settings"

const banda: ProjectSummary = {
  id: "b1",
  name: "banda",
  folder: "/code/banda",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "B", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
}

const row: Arranged = {
  project: banda,
  listed: {
    id: "t1",
    title: "Bench window tests",
    mark: "asking",
    changed: 1,
    pane: { kind: "agents.thread", args: { thread: "t1", host: "arc" } },
  },
  state: "active",
  host: "arc",
}

const arc: Named = { name: "arc", icon: "server" }

/** The row drawn in `lines`, hiding `hide`, on `machine`; its title as a
 * field draws it, as the title's own reads the window's store. */
const drawn = (lines: number, machine?: Named, hide: Part[] = []) => {
  const settings: Settings = {
    ...DEFAULT_SIDEBAR,
    row: { ...DEFAULT_SIDEBAR.row, lines, hide },
  }
  return renderToStaticMarkup(
    <Row
      row={row}
      settings={settings}
      inProject={false}
      current={false}
      onOpen={() => undefined}
      field={<span>Bench window tests</span>}
      machine={machine}
    />
  )
}

const TIP = 'title="Its Agent works on arc"'

test("on a row with room, another machine stands after its Project: its icon and name, small and muted, with no border", () => {
  const html = drawn(2, arc)
  expect(html).toContain(TIP)
  expect(html).toContain('data-machine-icon="server"')
  expect(html).toMatch(/max-w-16[^"]*">arc<\/span>/)
  const mark = new RegExp(`<span ${TIP} class="([^"]*)"`).exec(html)?.[1]
  expect(mark).toContain("text-xs")
  expect(mark).toContain("text-muted-foreground")
  expect(mark).not.toMatch(/\b(border|bg-|rounded)/)
  // The Project, then the machine.
  expect(html.indexOf(">banda<")).toBeLessThan(html.indexOf(TIP))
})

test("a row of one line shows the machine's icon alone, its name in the tooltip", () => {
  const html = drawn(1, arc)
  expect(html).toContain(TIP)
  expect(html).toContain('data-machine-icon="server"')
  expect(html).toContain('<span class="sr-only">arc</span>')
  expect(html).not.toContain("max-w-16")
})

test("a row that hides its Project still says where its Thread runs", () => {
  const html = drawn(2, arc, ["project"])
  expect(html).not.toContain(">banda<")
  expect(html).toContain(TIP)
  expect(html).toMatch(/max-w-16[^"]*">arc<\/span>/)
  // This machine's row hides it with nothing in its place.
  expect(drawn(2, undefined, ["project"])).not.toContain("data-machine-icon")
})

test("a row of this machine carries no machine", () => {
  for (const lines of [1, 2, 3])
    expect(drawn(lines)).not.toContain("data-machine-icon")
})
