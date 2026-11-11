import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { type Listed, NO_REASON } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"
import { describe, expect, test } from "vitest"
import { placedOf, type Row } from "./arrange"
import {
  agoSaid,
  type CardModel,
  type CardOf,
  cardOf,
  type CardView,
  linesOf,
  spokenOf,
  timeAt,
  timeOf,
  timesOf,
} from "./card"

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()

const banda = { id: "p", name: "banda", scratch: false } as ProjectSummary
const arc: Named = { name: "arc", icon: "server" }

const listed = (more: Partial<Listed> = {}): Listed => ({
  id: "t",
  title: "Fix the form",
  mark: "asking",
  changed: NOW - 14 * MINUTE,
  calls: "Which port?",
  said: "fix the form",
  harness: "claude",
  by: "Claude Code",
  pane: { kind: "agents.thread", args: {} },
  ...more,
})
const row = (stand: Stand, more: Partial<Listed> = {}, host?: string): Row => ({
  project: banda,
  listed: listed(more),
  stand,
  ...(host === undefined ? {} : { host }),
})
const AUTO: CardView = { density: "auto", group: "none" }

/** The card of `row` drawn in its own place, its time from `at`. */
const card = (of: Row, more: Partial<Omit<CardOf, "row">> = {}): CardModel =>
  cardOf({
    row: of,
    place: of.stand,
    at: of.listed.changed,
    now: NOW,
    view: AUTO,
    ...more,
  })

/** What each line of `card` holds, by kind: left | right. */
const kinds = ({ lines }: CardModel) =>
  lines.map(
    ({ left, right }) =>
      `${left.map((slot) => slot.kind).join(" ")} | ${right.map((slot) => slot.kind).join(" ")}`
  )

describe("density (ADR 0098, decision 9)", () => {
  test("auto: three lines in Your turn, two there grouped by Project, one for the rest", () => {
    const places: Stand[] = ["turn", "open", "working", "later", "archived"]
    const auto = (group: CardView["group"]) =>
      places.map((place) => linesOf(place, { density: "auto", group }))
    expect(auto("none")).toEqual([3, 1, 1, 1, 1])
    expect(auto("project")).toEqual([2, 1, 1, 1, 1])
    expect(auto("machine")).toEqual([3, 1, 1, 1, 1])
  })

  test("a density the Person sets holds in every place", () => {
    for (const density of [1, 2, 3] as const)
      for (const place of ["turn", "working"] as const)
        expect(linesOf(place, { density, group: "none" })).toBe(density)
  })

  test("a card keeps the lines of the place it is drawn in, wherever its Thread stands now", () => {
    // Seen while the list held: open now, still in Your turn's slot.
    const held = card(row("open", { mark: "idle", calls: undefined }), {
      place: "turn",
    })
    expect(held.lines).toHaveLength(3)
    expect(held.place).toBe("turn")
    expect(held.stand).toBe("open")
    expect(held.tone).toBeUndefined()
  })
})

describe("slots, by place, density and group", () => {
  test("three lines: the mark and title | the time; a word and what it says; the Project | the machine and the Harness", () => {
    const asks = card(row("turn", {}, "arc"), { machine: arc })
    expect(kinds(asks)).toEqual([
      "mark title | time",
      "says | ",
      "project | machine harness",
    ])
    expect(asks.lines[2]!.left).toEqual([{ kind: "project", project: banda }])
    expect(asks.lines[2]!.right).toEqual([
      { kind: "machine", host: "arc", machine: arc, named: true },
      { kind: "harness", id: "claude", name: "Claude Code" },
    ])
  })

  test("grouped by Project, Your turn has two lines, and the machine moves to line 1's right", () => {
    const grouped = card(row("turn", {}, "arc"), {
      machine: arc,
      view: { density: "auto", group: "project" },
    })
    expect(kinds(grouped)).toEqual(["mark title | machine time", "says | "])
    expect(grouped.lines[0]!.right[0]).toEqual({
      kind: "machine",
      host: "arc",
      machine: arc,
      named: false,
    })
  })

  test("grouped by machine, its header names the machine; grouped by Project, line 3 has no Project", () => {
    const by = (group: CardView["group"]) =>
      kinds(
        card(row("turn", {}, "arc"), {
          machine: arc,
          view: { density: 3, group },
        })
      )
    expect(by("machine")).toEqual([
      "mark title | time",
      "says | ",
      "project | harness",
    ])
    expect(by("project")).toEqual([
      "mark title | time",
      "says | ",
      " | machine harness",
    ])
  })

  test("one line: the mark and the title | the time; a working row on another machine shows the machine and the time", () => {
    expect(kinds(card(row("open", { mark: "idle" })))).toEqual([
      "mark title | time",
    ])
    const working = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
    })
    expect(kinds(working)).toEqual(["mark title | machine time"])
    // This machine's names none.
    expect(kinds(card(row("working", { mark: "working" })))).toEqual([
      "mark title | time",
    ])
  })

  test("this machine, named as the others are, takes the same slots with no host, as it has no card; its icon alone, line 3 says no name (ADR 0095, decisions 4 and 5)", () => {
    const mac: Named = { name: "mac", icon: "laptop" }
    const asks = card(row("turn"), { machine: mac })
    expect(asks.lines[2]!.right[0]).toEqual({
      kind: "machine",
      machine: mac,
      named: true,
    })
    expect(
      kinds(card(row("working", { mark: "working" }), { machine: mac }))
    ).toEqual(["mark title | machine time"])
    const alone = card(row("turn", {}, "arc"), {
      machine: { ...arc, alone: true },
    })
    expect(alone.lines[2]!.right[0]).toEqual({
      kind: "machine",
      host: "arc",
      machine: arc,
      named: false,
    })
  })

  test("the mark shows the Thread's look", () => {
    const look = (of: Row) => card(of).lines[0]!.left[0]
    expect(look(row("turn"))).toEqual({ kind: "mark", look: "asking" })
    expect(look(row("open", { mark: "rest", calls: undefined }))).toEqual({
      kind: "mark",
      look: "idle",
    })
    expect(
      look(row("later", { mark: "done", later: { at: NOW, someday: true } }))
    ).toEqual({ kind: "mark", look: "later" })
  })
})

describe("line 2's words (decision 8, spec §2.6)", () => {
  const says = (of: Row) => card(of, { place: "turn" }).lines[1]!
  test("Asks and its question; Failed and why; Done and its note", () => {
    expect(says(row("turn")).left).toEqual([
      { kind: "says", word: "Asks", text: "Which port?" },
    ])
    expect(
      says(row("turn", { mark: "failed", calls: "Out of tokens" })).left
    ).toEqual([{ kind: "says", word: "Failed", text: "Out of tokens" }])
    expect(
      says(row("turn", { mark: "done", calls: "Toast and a test added" })).left
    ).toEqual([{ kind: "says", word: "Done", text: "Toast and a test added" }])
    // With no note, Done alone: what the Person asked is not its word.
    expect(says(row("turn", { mark: "done", calls: undefined })).left).toEqual([
      { kind: "says", word: "Done" },
    ])
  })

  test("a failure with no reason says Failed alone, not that the turn failed", () => {
    expect(
      says(row("turn", { mark: "failed", calls: NO_REASON })).left
    ).toEqual([{ kind: "says", word: "Failed" }])
  })

  test("Failed has nothing on the right, nor has anything before the PR and the diff come", () => {
    for (const mark of ["failed", "done", "asking"] as const)
      expect(says(row("turn", { mark })).right).toEqual([])
  })

  test("Woke says who put it off, and what it said", () => {
    const woke = row("turn", {
      later: { at: NOW - 3 * HOUR, woke: { at: NOW - MINUTE, by: "time" } },
    })
    expect(says(woke).left).toEqual([
      {
        kind: "says",
        word: "Woke",
        putOff: { at: NOW - 3 * HOUR, byAgent: false },
        text: "Which port?",
      },
    ])
    const byAgent = row("turn", {
      mark: "rest",
      calls: undefined,
      later: {
        at: NOW - HOUR,
        byAgent: true,
        woke: { at: NOW - MINUTE, by: "time" },
      },
    })
    expect(says(byAgent).left).toEqual([
      { kind: "says", word: "Woke", putOff: { at: NOW - HOUR, byAgent: true } },
    ])
  })

  test("a card that calls for nothing says what it was asked, with no word", () => {
    const open = card(row("open", { mark: "idle", calls: undefined }), {
      view: { density: 2, group: "none" },
    })
    expect(open.lines[1]!.left).toEqual([
      { kind: "says", text: "fix the form" },
    ])
  })
})

describe("tones: colour only on the mark and on a call's time", () => {
  test("each call's colour, on the card and its time", () => {
    const tone = (more: Partial<Listed>) => {
      const one = card(row("turn", more))
      return [one.tone, one.time.kind === "ago" ? one.time.tone : "-"]
    }
    expect(tone({})).toEqual(["attention", "attention"])
    expect(tone({ mark: "failed" })).toEqual(["destructive", "destructive"])
    expect(tone({ mark: "done" })).toEqual(["added", "added"])
    expect(
      tone({
        later: { at: NOW - HOUR, woke: { at: NOW - MINUTE, by: "time" } },
      })
    ).toEqual(["woke", "woke"])
  })

  test("what calls no one has no colour; work is grey, and what is put off or archived asleep", () => {
    const open = card(row("open", { mark: "idle", calls: undefined }))
    expect([open.tone, open.quiet, open.time]).toEqual([
      undefined,
      undefined,
      { kind: "ago", at: NOW - 14 * MINUTE },
    ])
    const working = card(row("working", { mark: "working" }))
    expect([working.tone, working.quiet]).toEqual([undefined, "working"])
    const archived = card(row("archived", { mark: "rest", archived: true }))
    expect([archived.tone, archived.quiet]).toEqual([undefined, "archived"])
  })

  test("no slot but the mark carries a colour, on every card", () => {
    for (const mark of ["asking", "failed", "done"] as const)
      for (const density of [1, 2, 3] as const) {
        const one = card(row("turn", { mark }, "arc"), {
          machine: arc,
          view: { density, group: "none" },
        })
        expect(JSON.stringify(one.lines)).not.toMatch(
          /tone|attention|destructive|added/
        )
      }
  })

  test("the counts' list takes the same time and colour", () => {
    expect(timeAt(placedOf(listed(), NOW), "asking")).toEqual({
      kind: "ago",
      at: NOW - 14 * MINUTE,
      tone: "attention",
    })
    const working = listed({ mark: "working", began: NOW - HOUR })
    expect(timeAt(placedOf(working, NOW), "working")).toEqual({
      kind: "ago",
      at: NOW - HOUR,
    })
  })
})

describe("times (spec §2.5)", () => {
  test("each place counts from its moment; Later says when it wakes", () => {
    expect(timeOf(row("open", { mark: "idle" }), 5)).toEqual({
      kind: "ago",
      at: 5,
    })
    expect(timeOf(row("turn"), 5, "attention")).toEqual({
      kind: "ago",
      at: 5,
      tone: "attention",
    })
    const later = (more: Listed["later"]) =>
      timeOf(row("later", { later: more }), 0)
    expect(later({ at: 0, until: NOW + HOUR })).toEqual({
      kind: "wakes",
      at: NOW + HOUR,
    })
    expect(later({ at: 0, someday: true })).toEqual({ kind: "someday" })
    expect(later({ at: 0 })).toEqual({ kind: "when done" })
  })

  test("the times that change: its own, or how long its machine is away, and when it was put off", () => {
    const woke = card(
      row("turn", {
        later: { at: NOW - HOUR, woke: { at: NOW - MINUTE, by: "time" } },
      })
    )
    expect(timesOf(woke)).toEqual([woke.time, { kind: "ago", at: NOW - HOUR }])
    const away = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
      away: NOW - 12 * MINUTE,
    })
    expect(timesOf(away)).toEqual([{ kind: "ago", at: NOW - 12 * MINUTE }])
  })
})

describe("spokenOf (spec §2.8)", () => {
  test("the name is the title, the word and the time in full; the description the other lines", () => {
    const asks = card(row("turn", {}, "arc"), { machine: arc })
    expect(spokenOf(asks, NOW)).toEqual({
      name: "Fix the form, Asks, 14 minutes",
      description: "Asks Which port? banda. arc. Claude Code",
    })
    const working = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
      at: NOW - 2 * HOUR,
    })
    expect(spokenOf(working, NOW)).toEqual({
      name: "Fix the form, Working, 2 hours",
      description: "arc",
    })
    const failed = card(
      row("turn", { mark: "failed", calls: "3 tests fail · #1061 ✗" })
    )
    expect(spokenOf(failed, NOW).description).toBe(
      "Failed 3 tests fail. #1061 failed. banda. Claude Code"
    )
  })

  test("Woke says who put it off, in full, and just now in its first seconds", () => {
    const now = card(
      row("turn", {
        later: { at: NOW - 5_000, woke: { at: NOW, by: "time" } },
      })
    )
    expect(spokenOf(now, NOW).description).toMatch(
      /^Woke You put it off just now\./
    )
    const woke = card(
      row("turn", {
        later: { at: NOW - 3 * HOUR, woke: { at: NOW - MINUTE, by: "time" } },
      })
    )
    expect(spokenOf(woke, NOW).description).toBe(
      "Woke You put it off 3 hours ago. Which port? banda. Claude Code"
    )
  })

  test("Later says when it wakes", () => {
    const later = (more: Listed["later"]) =>
      spokenOf(
        card(row("later", { mark: "rest", calls: undefined, later: more })),
        NOW
      ).name
    const at = new Date(2026, 10, 10, 18, 30).getTime()
    expect(later({ at: NOW, until: at })).toBe(
      "Fix the form, Later, wakes at 18:30"
    )
    const friday = new Date(2026, 10, 13, 9, 0).getTime()
    expect(later({ at: NOW, until: friday })).toBe(
      "Fix the form, Later, wakes Friday at 9:00"
    )
    expect(later({ at: NOW, until: new Date(2026, 11, 3, 9).getTime() })).toBe(
      "Fix the form, Later, wakes December 3"
    )
    expect(later({ at: NOW, someday: true })).toBe(
      "Fix the form, Later, someday"
    )
    expect(later({ at: NOW })).toBe("Fix the form, Later, when it's done")
  })

  test("its time in full, by the steps the card's takes", () => {
    const ago = (ms: number) => agoSaid(NOW - ms, NOW)
    expect([
      ago(0),
      ago(9_000),
      ago(40_000),
      ago(MINUTE),
      ago(14 * MINUTE),
      ago(HOUR),
      ago(2 * HOUR),
      ago(DAY),
      ago(3 * DAY),
    ]).toEqual([
      "now",
      "now",
      "40 seconds",
      "1 minute",
      "14 minutes",
      "1 hour",
      "2 hours",
      "1 day",
      "3 days",
    ])
    expect(agoSaid(new Date(2026, 2, 3).getTime(), NOW)).toBe("March 3")
    expect(agoSaid(new Date(2025, 2, 3).getTime(), NOW)).toBe("March 2025")
  })

  test("an away machine adds itself, and its time stands as it went; one that strayed or left adds that", () => {
    const away = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
      at: NOW - 30 * MINUTE,
      away: NOW - 12 * MINUTE,
    })
    expect(spokenOf(away, NOW)).toEqual({
      name: "Fix the form, Working, 18 minutes",
      description: "arc. arc is away, 12 minutes",
    })
    const stopped = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
      away: NOW - 12 * MINUTE,
      stopped: true,
    })
    expect(spokenOf(stopped, NOW).description).toBe(
      "arc. arc is stopped, 12 minutes"
    )
    const gone = (went: NonNullable<CardOf["went"]>) =>
      spokenOf(
        card(row("archived", { mark: "rest", archived: true }), {
          place: "open",
          went,
        }),
        NOW
      ).description
    expect(gone({ to: "archived", from: "open" })).toBe("Moved to Archive")
    expect(
      gone({
        to: "later",
        from: "turn",
        until: new Date(2026, 10, 10, 18, 30).getTime(),
      })
    ).toBe("Moved to Later, wakes at 18:30")
    expect(gone({ to: "deleted", from: "open" })).toBe("Deleted")
    const strayed = card(row("open", { mark: "idle", calls: undefined }), {
      strayed: true,
    })
    expect(spokenOf(strayed, NOW).description).toBe(
      "Away from its Project's workspace"
    )
  })

  test("one that left shows where it went in its time's place, short; nothing where its Mark says it", () => {
    const left = (went: NonNullable<CardOf["went"]>) =>
      card(row("open", { mark: "idle", calls: undefined }), {
        place: "later",
        went,
      }).gone
    expect(left({ to: "archived", from: "open" })).toEqual({
      words: "Archived",
      said: "Moved to Archive",
    })
    expect(left({ to: "turn", from: "working" })).toEqual({
      words: "",
      said: "Moved to Your turn",
    })
  })
})
