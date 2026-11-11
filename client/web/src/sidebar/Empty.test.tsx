import type { ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { type Row, rowsOf } from "./rows"
import {
  type EmptyBlock,
  EmptyPlace,
  emptySays,
  EmptyTab,
  InboxZero,
  SOMEDAY_HEAD,
  zeroSays,
} from "./Empty"
import { type InboxView, inboxOf, TABS } from "./inbox"

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()
const AT_1830 = new Date(2026, 10, 10, 18, 30).getTime()

test("inbox zero says how many work and when the next wakes, what does not apply left out", () => {
  expect(zeroSays({ working: 7, next: AT_1830 }, NOW)).toBe(
    "7 at work · next wakes at 18:30"
  )
  expect(zeroSays({ working: 2 }, NOW)).toBe("2 at work")
  expect(zeroSays({ working: 0, next: AT_1830 }, NOW)).toBe(
    "next wakes at 18:30"
  )
  expect(zeroSays({ working: 0 }, NOW)).toBe("No Agent works now")
})

test("an empty tab says what goes there, and the key that puts it there when one does", () => {
  expect(emptySays("working")).toEqual({ big: "No Agent works now" })
  expect(emptySays("later", "Alt+Z")).toEqual({
    big: "Nothing for later",
    small: "Alt+Z on a Thread puts it here.",
  })
  expect(emptySays("archive", "Alt+S")).toEqual({
    big: "Nothing archived yet",
    small: "Alt+S on a Thread closes it here.",
  })
  // With no key in force, it names none.
  expect(emptySays("later")).toEqual({ big: "Nothing for later" })
})

test("inbox zero draws its words, and Someday's way to Later only on the week's first", () => {
  const plain = renderToStaticMarkup(<InboxZero zero={{ working: 0 }} />)
  expect(plain).toContain("Nothing waits for you")
  expect(plain).toContain("No Agent works now")
  expect(plain).not.toContain("someday")
  const weekly = renderToStaticMarkup(
    <InboxZero zero={{ working: 1, someday: 4 }} />
  )
  expect(weekly).toContain("4 someday ›")
})

test("Someday's line shows Later at Someday's head, by the key the Inbox gives it", () => {
  const sleeping: Row = {
    project: { id: "p1", name: "banda", folder: "/p1" } as ProjectSummary,
    listed: {
      id: "one day",
      title: "one day",
      mark: "rest",
      changed: NOW - 60_000,
      later: { at: NOW - 60_000, someday: true },
    } as Listed,
    stand: "later",
  }
  const { blocks } = inboxOf([sleeping], { tab: "later" }, NOW)
  expect(blocks.map((block) => block.key)).toContain(SOMEDAY_HEAD)
})

test("only an empty Working offers a New Thread", () => {
  const working = renderToStaticMarkup(
    <EmptyTab tab="working" only={undefined} projects={[]} />
  )
  expect(working).toContain("No Agent works now")
  expect(working).toContain("New Thread")
  const later = renderToStaticMarkup(
    <EmptyTab tab="later" only={undefined} projects={[]} />
  )
  expect(later).toContain("Nothing for later")
  expect(later).not.toContain("New Thread")
  expect(
    renderToStaticMarkup(
      <EmptyTab tab="archive" only={undefined} projects={[]} />
    )
  ).toContain("Nothing archived yet")
})

/** A Thread in each place, by its place, as its App lists it. */
const IN: Readonly<Record<Row["stand"], Partial<Listed>>> = {
  turn: { mark: "asking", calls: "Which port?" },
  open: { mark: "rest" },
  working: { mark: "running", began: NOW - 60_000 },
  later: { mark: "rest", later: { at: NOW - 60_000, until: AT_1830 } },
  archived: { mark: "rest", archived: true },
}

/** The big line an empty place's markup says, if any. */
const bigLine = (html: string) =>
  /data-slot="empty-title"[^>]*>([^<]*)</.exec(html)?.[1]?.trim() ?? ""

test("every empty place says what goes there: each tab, and each part of the Inbox alone, grouped or not, with Open and the shelf or without (ADR 0098, decision 25)", () => {
  const project = { id: "p1", name: "banda", scratch: false } as ProjectSummary
  // Nothing at all, then a Thread in one place alone; and one that sleeps
  // until Someday, which inbox zero tells of.
  const sets: Array<[string, Row[]]> = [
    ["nothing", []],
    ...Object.entries(IN).map(([stand, more]): [string, Row[]] => [
      stand,
      rowsOf(
        {
          p1: [
            { id: stand, title: stand, changed: NOW - 60_000, ...more },
          ] as Listed[],
        },
        [project],
        NOW
      ),
    ]),
    [
      "someday",
      rowsOf(
        {
          p1: [
            {
              id: "dream",
              title: "dream",
              mark: "rest",
              changed: NOW - 60_000,
              later: { at: NOW - 60_000, someday: true },
            },
          ] as Listed[],
        },
        [project],
        NOW
      ),
    ],
  ]
  const views = TABS.flatMap((tab) =>
    (["none", "project", "machine"] as const).flatMap((group) =>
      [true, false].flatMap((open) =>
        [true, false].map((working): InboxView => ({
          tab,
          group,
          open,
          working,
        }))
      )
    )
  )
  for (const [name, rows] of sets)
    for (const view of views) {
      const said = `${name} on ${JSON.stringify(view)}`
      const { blocks } = inboxOf(rows, view, NOW)
      const cards = blocks.some(
        (block) => block.kind === "rows" && block.rows.length > 0
      )
      const places = blocks.filter(
        (block): block is EmptyBlock =>
          block.kind === "zero" || block.kind === "empty"
      )
      // A tab with no card in it is never blank.
      if (!cards) expect(places, said).not.toHaveLength(0)
      for (const place of places) {
        const html = renderToStaticMarkup(
          <EmptyPlace place={place} only={undefined} projects={[]} />
        )
        expect(bigLine(html), said).not.toBe("")
      }
    }
})
