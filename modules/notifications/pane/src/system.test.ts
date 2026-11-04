import { expect, test } from "vitest"
import { loudestOf, noticeOf, summaryOf } from "./system"
import type { Call } from "@banda/ui/pane"

const heard = (about: string, chime: Call["chime"], detail?: string) =>
  ({
    about,
    chime,
    title: about,
    ...(detail ? { detail } : {}),
    pane: { kind: "agents.thread", args: { thread: about } },
    key: `s:${about}`,
    space: "s",
    since: 1,
  }) satisfies Call

test("a notice names the Thread and says what it said; one that waits stays", () => {
  expect(noticeOf(heard("Tests", "asking", "Run on staging?"), true)).toEqual({
    key: "s:Tests",
    title: "Tests",
    body: "Asks you · Run on staging?",
    answer: "Answer",
    lasts: true,
  })
  expect(
    noticeOf(heard("Tests", "asking", "Run on staging?"), false).body
  ).toBe("Asks you")
  const done = noticeOf(heard("Docs", "done"), true)
  expect(done).toMatchObject({ body: "Done", answer: "Open", lasts: false })
})

test("many calls at once make one notice that names them all", () => {
  const calls = [heard("A", "done"), heard("B", "failed"), heard("C", "done")]
  expect(summaryOf(calls)).toEqual({
    key: "calls",
    title: "3 Threads call you",
    body: "A, B, C",
    answer: "Show",
    lasts: true,
  })
  expect(loudestOf(calls)).toBe("failed")
  expect(summaryOf([heard("A", "done"), heard("B", "done")]).lasts).toBe(false)
})
