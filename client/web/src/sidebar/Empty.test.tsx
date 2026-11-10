import type { ProjectSummary } from "@banda/contract"
import { clock } from "@banda/core/react"
import type { Listed } from "@banda/ui/pane"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import type { Row } from "./arrange"
import { emptySays, EmptyTab, InboxZero, SOMEDAY_HEAD, zeroSays } from "./Empty"
import { inboxOf } from "./inbox"

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()
const AT_1830 = new Date(2026, 10, 10, 18, 30).getTime()

test("inbox zero says how many work and when the next wakes, what does not apply left out", () => {
  expect(zeroSays({ working: 7, next: AT_1830 }, NOW)).toBe(
    `7 at work · next wakes at ${clock(AT_1830, NOW)}`
  )
  expect(zeroSays({ working: 2 }, NOW)).toBe("2 at work")
  expect(zeroSays({ working: 0, next: AT_1830 }, NOW)).toBe(
    `next wakes at ${clock(AT_1830, NOW)}`
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
