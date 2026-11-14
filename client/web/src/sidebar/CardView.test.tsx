// @vitest-environment happy-dom
import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { CutTips } from "@banda/ui/components/fade-text"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Row } from "./rows"
import { Card, type CardAct } from "./CardView"
import { cardOf, type CardOf } from "./card"

// The title reads the window's naming store, which a page's render has
// none of.
vi.mock("@banda/ui/lib/naming", () => ({
  THINKING: "Naming…",
  useThinking: () => false,
}))

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

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
const arc: Named = { name: "arc", icon: "server" }

const rowOf = (
  stand: Stand,
  more: Partial<Listed> = {},
  host?: string
): Row => ({
  project: banda,
  listed: {
    id: "t1",
    title: "Bench window tests",
    mark: "asking",
    changed: NOW - 14 * MINUTE,
    calls: "Which port for the dev server?",
    harness: "claude",
    by: "Claude Code",
    pane: { kind: "agents.thread", args: { thread: "t1" } },
    ...more,
  },
  stand,
  ...(host === undefined ? {} : { host }),
})

/** The card of `row`, drawn in its own place, as the sidebar draws it,
 * with `acts`. */
const cardElement = (
  row: Row,
  more: Partial<Omit<CardOf, "row">> = {},
  current = false,
  acts?: readonly CardAct[]
) => (
  <Card
    card={cardOf({
      row,
      place: row.stand,
      at: row.listed.changed,
      now: Date.now(),
      view: { density: "auto", group: "none" },
      ...more,
    })}
    row={row}
    current={current}
    acts={acts}
  />
)

const drawn = (...of: Parameters<typeof cardElement>) =>
  renderToStaticMarkup(cardElement(...of))

/** The classes of the first element `html` has with `attribute`. */
const classOf = (html: string, attribute: string) =>
  new RegExp(`<[^>]*${attribute}[^>]*class="([^"]*)"`).exec(html)?.[1] ??
  new RegExp(`<[^>]*class="([^"]*)"[^>]*${attribute}`).exec(html)?.[1]

test("an asking card: orange only on its mark and its time; Asks in the text's colour, then its question", () => {
  const html = drawn(rowOf("turn"))
  expect(html).toContain('data-tone="attention"')
  expect(classOf(html, "data-time")).toContain("text-attention")
  expect(html).toMatch(/data-time=""[^>]*>14m</)
  expect(html.match(/text-attention/g)).toHaveLength(2)
  expect(/<svg[^>]*data-look="asking".*?<\/svg>/.exec(html)?.[0]).toContain(
    "text-attention"
  )
  // The word and the question are in the text's colours, never orange.
  expect(html).toMatch(
    /text-foreground\/85">Asks<\/span> Which port for the dev server\?<\/span>/
  )
})

test("Done's note is never red", () => {
  const noted = drawn(
    rowOf("turn", { mark: "done", calls: "Toast and a test added" })
  )
  expect(classOf(noted, "data-time")).toContain("text-added")
  expect(noted).toMatch(/>Done<\/span> Toast and a test added<\/span>/)
  expect(noted).not.toContain("text-destructive")
})

test("a PR's chip is in grey, its glyph alone in a colour: green passed, red failed, a still blue dot while its checks run; merged in grey (F2)", () => {
  const chip = (state: "passing" | "failing" | "running" | "merged") => {
    const pull = {
      host: "github.com",
      repo: "o/r",
      number: 1061,
      url: "https://github.com/o/r/pull/1061",
      threads: ["t1"],
      owner: "t1",
      by: "agent" as const,
      auto_fix: true,
      snapshot: {
        state: state === "merged" ? ("merged" as const) : ("open" as const),
        draft: false,
        title: "feat: the chip",
        head: "feat/chip",
        base: "main",
        ...(state === "merged" ? {} : { checks: state }),
        counted: { passed: 0, failed: 0, running: 0, total: 0 },
        asked_of_you: false,
        conflicts: false,
        auto_merge: false,
        additions: 1,
        deletions: 0,
        updated_at: NOW,
        synced_at: NOW,
      },
    }
    const html = drawn(
      rowOf("turn", { mark: "done", calls: "Shipped", pulls: [pull] })
    )
    return /<span data-pull="[^"]*" class="([^"]*)">(.*?)<\/span><\/span>/.exec(
      html
    )
  }
  for (const [state, glyph, colour] of [
    ["passing", "✓", "text-added"],
    ["failing", "✗", "text-destructive"],
    ["running", "•", "text-mark-working"],
  ] as const) {
    const [, grey, inside] = chip(state)!
    expect(grey).toContain("text-muted-foreground/60")
    expect(inside).toBe(`#1061 <span class="${colour}">${glyph}`)
  }
  const [, , merged] = chip("merged")!
  expect(merged).toBe("#1061 <span>merged")
})

test("a woke card's time is the darker yellow small text takes; its mark keeps its own", () => {
  const html = drawn(
    rowOf("turn", {
      later: { at: NOW - HOUR, woke: { at: NOW - MINUTE, by: "time" } },
    })
  )
  expect(classOf(html, "data-time")).toContain("text-woke-text")
  expect(/<svg[^>]*data-look="woke".*?<\/svg>/.exec(html)?.[0]).toContain(
    "text-woke"
  )
  expect(html).toContain("You put it off 1h ago · Which port")
})

test("a screen reader hears the card by spokenOf", () => {
  const html = drawn(rowOf("turn"))
  expect(html).toContain('aria-label="Bench window tests, Asks, 14 minutes"')
  expect(html).toContain(
    'aria-description="Asks Which port for the dev server? banda. Claude Code"'
  )
})

test("a working card's line 2 says what its Agent does, muted as its time; at the limit, line 1's right says when it goes on", () => {
  const two = { view: { density: 2, group: "none" } } as const
  const runs = drawn(
    rowOf("working", {
      mark: "working",
      doing: { what: "execute", title: "pnpm test", since: NOW },
      stepped: NOW,
    }),
    two
  )
  expect(runs).toMatch(/text-muted-foreground\/60">pnpm test<\/span>/)
  expect(runs).toContain('aria-description="pnpm test"')
  const limited = drawn(
    rowOf("working", {
      mark: "working",
      limitUntil: new Date(2026, 10, 10, 16, 0).getTime(),
    }),
    two
  )
  expect(limited).toMatch(/data-time=""[^>]*>16:00</)
  expect(limited).toContain(">Usage limit · goes on at 16:00</span>")
})

// ADR 0099, decision 2: the words hold as the Mark does, by one hold.
test("a working card's words and its Mark change together, each doing held 1.5 s", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div"))
  const live = createRoot(host)
  const draw = (what: "execute" | "read", title: string) =>
    act(() =>
      live.render(
        cardElement(
          rowOf("working", {
            mark: "working",
            doing: { what, title, since: Date.now() },
            stepped: Date.now(),
          }),
          { view: { density: 2, group: "none" } }
        )
      )
    )
  // Line 2's words.
  const words = () => host.querySelector("[data-card] > span:nth-child(2)")
  const doing = () =>
    host.querySelector("svg[data-look]")?.getAttribute("data-doing")
  await draw("execute", "pnpm test")
  expect(words()?.textContent).toBe("pnpm test")
  expect(doing()).toBe("execute")
  await act(() => vi.advanceTimersByTime(300))
  await draw("read", "card.ts")
  expect(words()?.textContent).toBe("pnpm test")
  expect(doing()).toBe("execute")
  await act(() => vi.advanceTimersByTime(1199))
  expect(words()?.textContent).toBe("pnpm test")
  await act(() => vi.advanceTimersByTime(1))
  expect(words()?.textContent).toBe("Reads card.ts")
  expect(doing()).toBe("read")
  act(() => live.unmount())
  host.remove()
})

test("its machine away, its time stands as it was then", () => {
  const html = drawn(rowOf("working", { mark: "working" }, "arc"), {
    machine: arc,
    at: NOW - 30 * MINUTE,
    away: NOW - 12 * MINUTE,
  })
  expect(html).toMatch(/data-time=""[^>]*>18m</)
})

test("a machine the window does not reach: a card says how long ago as of when it was last heard, not as of now", () => {
  const said = (away?: number) =>
    drawn(rowOf("open", { mark: "rest" }, "arc"), {
      machine: arc,
      at: NOW - 15 * MINUTE,
      ...(away === undefined ? {} : { away }),
    })
  // Heard 30 s after it changed: "30s", however long ago that was.
  expect(said(NOW - 15 * MINUTE + 30_000)).toMatch(/data-time=""[^>]*>30s</)
  expect(said(NOW - 11 * MINUTE)).toMatch(/data-time=""[^>]*>4m</)
  // Reached, it counts on to now.
  expect(said()).toMatch(/data-time=""[^>]*>15m</)
})

/** Another machine's mark, which opens its card (`MachineCard`). */
const CARD = 'data-machine-card="arc"'

test("with its icon alone, a card of three lines draws the machine as a card of one line does, its name said to a screen reader", () => {
  const html = drawn(rowOf("turn", {}, "arc"), {
    machine: { ...arc, alone: true },
  })
  expect(html).toContain(CARD)
  expect(html).toContain('data-machine-icon="server"')
  expect(html).toContain('<span class="sr-only">arc</span>')
  expect(html).not.toContain("max-w-16")
  const named = drawn(rowOf("turn", {}, "arc"), { machine: arc })
  expect(named).toMatch(/max-w-16[^"]*">arc<\/span>/)
})

test("this machine named too has no card, as it is here; alone, its name is the icon's tooltip", () => {
  const mac: Named = { name: "mac", icon: "laptop" }
  const html = drawn(rowOf("turn"), { machine: mac })
  expect(html).not.toContain("data-machine-card")
  expect(html).toContain('data-machine-icon="laptop"')
  expect(html).toMatch(/max-w-16[^"]*">mac<\/span>/)
  expect(drawn(rowOf("open", { mark: "rest" }), { machine: mac })).toContain(
    'title="mac"'
  )
})

test("a Thread away from its Project's workspace bears a small diamond: right after its title on one or two lines, at the start of line 3's right on three, never at line 1's right, where the acts show (ADR 0102, decision 6; spec S6b)", () => {
  for (const group of ["none", "project"] as const) {
    for (const density of [1, 2] as const) {
      const html = drawn(rowOf("turn"), {
        view: { density, group },
        strayed: true,
      })
      const mark = html.indexOf("lucide-diamond")
      expect(mark, `${density} lines`).toBeGreaterThan(-1)
      expect(mark).toBeGreaterThan(html.indexOf(">Bench window tests<"))
      expect(mark).toBeLessThan(html.indexOf('class="ml-auto'))
      expect(html).toContain('title="Away from its Project&#x27;s workspace"')
    }
    const three = drawn(rowOf("turn"), {
      view: { density: 3, group },
      strayed: true,
    })
    // Line 3's right starts with it, before the Harness's emblem.
    const third = three.lastIndexOf('class="ml-auto')
    expect(three.indexOf("lucide-diamond")).toBeGreaterThan(third)
    expect(three.slice(third)).toMatch(
      /^class="ml-auto[^"]*"><span title="Away from its Project&#x27;s workspace"/
    )
  }
  const plain = drawn(rowOf("turn"))
  expect(plain).not.toContain("lucide-diamond")
})

test('a card\'s text fades where it does not fit, never with "…"; the title is only as wide as its words, and inside the cut tooltip each text names itself whole (spec S6b)', () => {
  const html = drawn(rowOf("turn"))
  expect(html).not.toMatch(/truncate|ellipsis|…/)
  // The title, what line 2 says, and the Project's name.
  expect(html.match(/data-slot="fade-text"/g)).toHaveLength(3)
  expect(html).toMatch(
    /<span data-slot="fade-text" class="min-w-0 overflow-hidden whitespace-nowrap text-ui[^"]*"><span>Bench/
  )
  // Outside a CutTips, none is a tooltip's trigger.
  expect(html).not.toContain("data-base-ui-tooltip-trigger")
  const tipped = renderToStaticMarkup(
    <CutTips edge="aside">
      <Card
        card={cardOf({
          row: rowOf("turn"),
          place: "turn",
          at: NOW - 14 * MINUTE,
          now: NOW,
          view: { density: "auto", group: "none" },
        })}
        row={rowOf("turn")}
        current={false}
      />
    </CutTips>
  )
  expect(tipped.match(/data-base-ui-tooltip-trigger/g)).toHaveLength(3)
})

test("a screen reader hears the diamond once, in the card's description (ADR 0102, decision 6)", () => {
  const html = drawn(rowOf("open", { mark: "idle", calls: undefined }), {
    strayed: true,
  })
  expect(html).toMatch(
    /aria-description="[^"]*Away from its Project&#x27;s workspace"/
  )
  expect(/<svg[^>]*lucide-diamond[^>]*>/.exec(html)?.[0]).toContain(
    'aria-hidden="true"'
  )
})

/** Acts as the sidebar gives them, which do nothing here. */
const acts = (...given: Omit<CardAct, "run">[]): CardAct[] =>
  given.map((act) => ({ ...act, run: () => {} }))

test("a card's acts: Later's clock first, then Archive's check, Wake's arrow back and Unarchive's archive-restore; each tooltip names its key in force, and Wake who put it off (ADR 0098, decision 10)", () => {
  const html = drawn(
    rowOf("turn", { mark: "done" }),
    {},
    false,
    acts({ act: "later", key: "Alt+Z" }, { act: "archive", key: "Alt+S" })
  )
  const later = html.indexOf('aria-label="Later"')
  const archive = html.indexOf('aria-label="Archive"')
  expect(later).toBeGreaterThan(-1)
  expect(archive).toBeGreaterThan(later)
  expect(html).toContain('title="Later (Alt+Z)"')
  expect(html).toContain('title="Archive (Alt+S)"')
  expect(html.slice(later, archive)).toContain("lucide-clock")
  expect(html.slice(archive)).toContain("lucide-check")
  // 20 px, with 14 px icons (§2.5).
  expect(/<button[^>]*data-act="later"[^>]*>/.exec(html)?.[0]).toContain(
    "size-5"
  )
  expect(html).toMatch(/<svg[^>]*lucide-clock[^>]*size-3\.5/)

  const sleeping = drawn(
    rowOf("later", {
      mark: "idle",
      later: { at: NOW, until: NOW + HOUR, byAgent: true },
    }),
    {},
    false,
    acts({ act: "wake", note: "Later by its Agent" })
  )
  expect(sleeping).toContain('title="Wake · Later by its Agent"')
  expect(sleeping).toContain("lucide-undo-2")
  const archived = drawn(
    rowOf("archived", { mark: "rest", archived: true }),
    {},
    false,
    acts({ act: "unarchive", key: "Alt+S" })
  )
  expect(archived).toContain('title="Unarchive (Alt+S)"')
  expect(archived).toContain("lucide-archive-restore")
})

test("the acts and line 1's right share one cell, which keeps the acts' room while they show; no button holds them, and a card with none has no room", () => {
  const html = drawn(
    rowOf("turn", { mark: "done" }),
    {},
    false,
    acts({ act: "later" }, { act: "archive" })
  )
  // The time and the acts' room, in the same grid cell at line 1's right.
  expect(html).toMatch(
    /class="ml-auto grid shrink-0[^"]*"><span data-acts-time="" class="[^"]*\[grid-area:1\/1\][^"]*"><span data-time[^>]*>14m<\/span><\/span><span data-acts-room="" style="--room:42px" class="\[grid-area:1\/1\]"><\/span>/
  )
  // Only line 1 keeps a room.
  expect(html.match(/data-acts-room/g)).toHaveLength(1)
  // The acts stand over it, after the card, never in it: an option holds
  // no buttons, and the row closes right after them.
  expect(html).toMatch(
    /^<div data-row="true" class="relative"><div id="[^"]+" role="option"/
  )
  expect(html).toMatch(/<\/button><\/span><\/div>$/)

  // Without acts, line 1's right is as it was.
  expect(drawn(rowOf("turn"))).not.toMatch(/data-acts/)
})

test("the acts' room keeps the diamond in sight: on one or two lines it stands after the title, before the cell; on three, on line 3 (ADR 0102, decision 6)", () => {
  for (const density of [1, 2] as const) {
    const html = drawn(
      rowOf("open", { mark: "idle", calls: undefined }),
      { strayed: true, view: { density, group: "none" } },
      false,
      acts({ act: "later" }, { act: "archive" })
    )
    const diamond = html.indexOf("lucide-diamond")
    expect(diamond).toBeGreaterThan(html.indexOf(">Bench window tests<"))
    expect(diamond).toBeLessThan(html.indexOf("data-acts-time"))
  }
  const three = drawn(
    rowOf("turn"),
    { strayed: true },
    false,
    acts({ act: "later" })
  )
  expect(three.indexOf("lucide-diamond")).toBeGreaterThan(
    three.indexOf("data-acts-room")
  )
})
