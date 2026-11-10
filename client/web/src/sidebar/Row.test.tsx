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
  stand: "turn",
  host: "arc",
}

const arc: Named = { name: "arc", icon: "server" }

/** The row drawn in `lines`, hiding `hide`, on `machine`, under its
 * Project's header or not, away or not; its title as a field draws it,
 * as the title's own reads the window's store. */
const drawn = (
  lines: number,
  machine?: Named,
  hide: Part[] = [],
  { inProject = false, away = false } = {}
) => {
  const settings: Settings = {
    ...DEFAULT_SIDEBAR,
    row: { ...DEFAULT_SIDEBAR.row, lines, hide },
  }
  return renderToStaticMarkup(
    <Row
      row={row}
      settings={settings}
      inProject={inProject}
      current={false}
      field={<span>Bench window tests</span>}
      machine={machine}
      away={away}
    />
  )
}

/** The machine's mark, which opens its card (`MachineCard`). */
const CARD = 'data-machine-card="arc"'

test("on a row with room, another machine stands after its Project: its icon and name, small and muted, with no border", () => {
  const html = drawn(2, arc)
  expect(html).toContain(CARD)
  expect(html).toContain('data-machine-icon="server"')
  expect(html).toMatch(/max-w-16[^"]*">arc<\/span>/)
  const mark = new RegExp(`${CARD}[^>]*><span title="" class="([^"]*)"`).exec(
    html
  )?.[1]
  expect(mark).toContain("text-xs")
  expect(mark).toContain("text-muted-foreground")
  expect(mark).not.toMatch(/\b(border|bg-|rounded)/)
  // The Project, then the machine.
  expect(html.indexOf(">banda<")).toBeLessThan(html.indexOf(CARD))
})

test("a row of one line shows the machine's icon alone, its name said to a screen reader and in its card", () => {
  const html = drawn(1, arc)
  expect(html).toContain(CARD)
  expect(html).toContain('data-machine-icon="server"')
  expect(html).toContain('<span class="sr-only">arc</span>')
  expect(html).not.toContain("max-w-16")
  // Its card says the rest: no tooltip besides.
  expect(html).not.toMatch(/title="[^"]/)
})

test("a row that hides its Project still says where its Thread runs", () => {
  const html = drawn(2, arc, ["project"])
  expect(html).not.toContain(">banda<")
  expect(html).toContain(CARD)
  expect(html).toMatch(/max-w-16[^"]*">arc<\/span>/)
  // This machine's row hides it with nothing in its place.
  expect(drawn(2, undefined, ["project"])).not.toContain("data-machine-icon")
})

test("a row of this machine carries no machine", () => {
  for (const lines of [1, 2, 3])
    expect(drawn(lines)).not.toContain("data-machine-icon")
})

test("a Thread away from its Project's workspace bears a small diamond before the row's right parts, where its Later clock never covers it (ADR 0102, decision 6)", () => {
  for (const lines of [1, 2, 3])
    for (const inProject of [false, true]) {
      const html = drawn(lines, undefined, [], { inProject, away: true })
      const mark = html.indexOf('aria-label="Away from its Project')
      expect(mark, `${lines} lines`).toBeGreaterThan(-1)
      expect(mark).toBeLessThan(html.indexOf('class="ml-auto"'))
      expect(html).toContain("lucide-diamond")
      // Its right parts stand where every row's do.
      expect(html).not.toContain("pe-7")
    }
  expect(drawn(1)).not.toContain("Away from its Project")
})

test("on a line with nothing at its right, the mark keeps clear of the row's Later clock all the same (ADR 0102, decision 6)", () => {
  // One line under its Project's header, its status hidden: the title
  // and the mark alone, and the line keeps the clock's room.
  const html = drawn(1, undefined, ["status"], { inProject: true, away: true })
  expect(html).not.toContain('class="ml-auto"')
  expect(html).toContain('class="flex min-w-0 items-center gap-1.5 pe-7"')
  expect(html).toContain('aria-label="Away from its Project')
  // A row not away keeps the whole line.
  expect(drawn(1, undefined, ["status"], { inProject: true })).not.toContain(
    "pe-7"
  )
})
