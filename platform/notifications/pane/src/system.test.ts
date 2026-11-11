import { expect, test } from "vitest"
import {
  GO_TO,
  JOINED,
  joinedOf,
  loudestOf,
  noticeOf,
  summaryOf,
  toldOfCall,
} from "./system"
import type { Call } from "@banda/ui/pane"

const heard = (about: string, chime: Call["chime"], detail?: string) =>
  ({
    about,
    chime,
    title: about,
    ...(detail ? { detail } : {}),
    pane: { kind: "agents.thread", args: { thread: about } },
    key: `s:${about}`,
    project: "s",
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

test("a sub-agent's question is titled Reviewer asks · ‹Thread›, and says what it asks alone", () => {
  const asks = {
    ...heard("Tests", "asking", "pnpm vitest"),
    asker: "Reviewer",
  }
  expect(noticeOf(asks, true)).toMatchObject({
    title: "Reviewer asks · Tests",
    body: "pnpm vitest",
    answer: "Answer",
    lasts: true,
  })
  expect(noticeOf(asks, true, "banda").title).toBe(
    "Reviewer asks · Tests · banda"
  )
  // Detail off says no more than today's word; without an asker, the
  // words are today's.
  expect(noticeOf(asks, false).body).toBe("Asks you")
  expect(noticeOf(heard("Tests", "asking", "pnpm vitest"), true)).toMatchObject(
    { title: "Tests", body: "Asks you · pnpm vitest" }
  )
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

test("with more than one Project, a call's notice and toast name its Project", () => {
  expect(noticeOf(heard("Tests", "done"), true, "banda").title).toBe(
    "Tests · banda"
  )
  expect(toldOfCall(heard("Tests", "done"), true, "banda")).toMatchObject({
    title: "Tests",
    project: "banda",
  })
  expect(toldOfCall(heard("Tests", "done"), true).project).toBeUndefined()
})

test("a call on another machine names that machine in words, after its Project, by the name it says it has, on its notice and its toast", () => {
  // Marked as arc's by the list it came in (`Call.host`): its Pane and
  // its answers name no host, as the directory places them.
  const there = (title: string): Call => ({
    ...heard(title, "asking"),
    pane: { kind: "agents.thread", args: { thread: title } },
    host: "arc",
  })
  // Before its first welcome here, by its key.
  expect(noticeOf(there("Bench"), true, "banda").title).toBe(
    "Bench · banda on arc"
  )
  expect(noticeOf(there("Bench"), true).title).toBe("Bench · arc")
  // Its toast, with its Allow and Deny, says where as its notice does.
  const answers = [
    { label: "Allow", action: "agents.answer", args: { choice: "once" } },
    { label: "Deny", action: "agents.answer", args: { choice: "no" } },
  ]
  expect(toldOfCall({ ...there("Bench"), answers }, true)).toMatchObject({
    title: "Bench",
    project: "arc",
    buttons: answers,
  })
  expect(toldOfCall(there("Bench"), true, "banda").project).toBe("banda on arc")
  // A notice draws no icon; this machine's calls name none.
  expect(noticeOf(heard("Tests", "done"), true, "banda").title).toBe(
    "Tests · banda"
  )
})

test("what answers a call there and then are its toast's buttons; a click opens it", () => {
  const allow = {
    label: "Allow",
    action: "agents.answer",
    args: { choice: "once" },
  }
  const deny = {
    label: "Deny",
    action: "agents.answer",
    args: { choice: "no" },
  }
  const told = toldOfCall(
    { ...heard("Tests", "asking"), answers: [allow, deny] },
    true
  )
  expect(told.buttons).toEqual([allow, deny])
  expect(told.open).toMatchObject({ label: "Answer", action: GO_TO })
  expect(toldOfCall(heard("Tests", "done"), true).open).toBeUndefined()
})

test("done calls that show at once join in one toast, a line each", () => {
  const joined = joinedOf(
    [heard("Docs", "done", "PR #470 is open"), heard("Tests", "done")],
    true
  )
  expect(joined).toMatchObject({
    key: JOINED,
    kind: "done",
    title: "2 Threads done",
    body: "Docs: PR #470 is open\nTests",
    buttons: [{ label: "Show", action: "sidebar.show" }],
  })
  expect(joinedOf([heard("Docs", "done", "PR #470")], false).body).toBe("Docs")
})
