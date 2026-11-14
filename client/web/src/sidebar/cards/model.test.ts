import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import type { Pull, Snapshot } from "@banda/contract/pulls"
import { type Listed, NO_REASON } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { DAY, HOUR, MINUTE } from "@banda/ui/lib/words"
import { describe, expect, test } from "vitest"
import type { Row } from "../rows"
import { awayShort } from "../../machines/words"
import {
  agoSaid,
  type CardModel,
  type CardOf,
  cardOf,
  type CardView,
  pullStateOf,
  type PullChip,
  pullWords,
  spokenOf,
  timeOf,
  timeShown,
  workSaid,
  worksWords,
} from "./model"
import { atOf } from "../inbox"

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
const ONE_LIST: CardView = { group: "none", lines: 3 }

/** Pull request `number` of `o/r`, open and read as `snapshot` says. */
const pull = (number: number, snapshot: Partial<Snapshot> = {}): Pull => ({
  host: "github.com",
  repo: "o/r",
  number,
  url: `https://github.com/o/r/pull/${number}`,
  threads: ["t"],
  owner: "t",
  by: "agent",
  auto_fix: true,
  snapshot: {
    state: "open",
    draft: false,
    title: "feat: the chip",
    head: "feat/chip",
    base: "main",
    counted: { passed: 0, failed: 0, running: 0, total: 0 },
    asked_of_you: false,
    conflicts: false,
    auto_merge: false,
    additions: 1,
    deletions: 0,
    updated_at: NOW,
    synced_at: NOW,
    ...snapshot,
  },
})

/** The card of `row` drawn in its own place, its time from `at`. */
const card = (of: Row, more: Partial<Omit<CardOf, "row">> = {}): CardModel =>
  cardOf({
    row: of,
    place: of.stand,
    at: of.listed.changed,
    now: NOW,
    view: ONE_LIST,
    ...more,
  })

/** What each line of `card` holds, by kind: left | right. */
const kinds = ({ lines }: CardModel) =>
  lines.map(
    ({ left, right }) =>
      `${left.map((slot) => slot.kind).join(" ")} | ${right.map((slot) => slot.kind).join(" ")}`
  )

describe("3, 2 or 1 lines (ADR 0098, decisions 8 and 9, as amended again)", () => {
  test("every card has the lines the Person picked, wherever it stands and however the list is grouped", () => {
    const places: Stand[] = ["turn", "open", "working", "later", "archived"]
    for (const lines of [3, 2, 1] as const)
      for (const group of ["none", "project"] as const)
        for (const place of places)
          expect(
            card(row(place), { view: { group, lines } }).lines
          ).toHaveLength(lines)
  })

  test("of two lines, line 3 goes; of one, line 2 too; line 3's machine goes to line 1's right by its icon, before the time", () => {
    const at = (lines: 3 | 2 | 1) =>
      card(row("turn", {}, "arc"), {
        machine: arc,
        view: { group: "none", lines },
      })
    expect(kinds(at(3))).toEqual([
      "mark title | time",
      "says | ",
      "project | machine harness",
    ])
    expect(kinds(at(2))).toEqual(["mark title | machine time", "says | "])
    expect(kinds(at(1))).toEqual(["mark title | machine time"])
    expect(at(1).lines[0]!.right[0]).toEqual({
      kind: "machine",
      host: "arc",
      machine: arc,
      named: false,
    })
    // With no machine, line 1 is as on three.
    expect(
      kinds(card(row("turn"), { view: { group: "none", lines: 1 } }))
    ).toEqual(["mark title | time"])
  })

  test("a card keeps the place it is drawn in, wherever its Thread stands now", () => {
    // Seen under the pointer: open now, still in Your turn's slot.
    const held = card(row("open", { mark: "idle", calls: undefined }), {
      place: "turn",
    })
    expect(held.place).toBe("turn")
    expect(held.stand).toBe("open")
    expect(held.tone).toBeUndefined()
  })
})

describe("a machine out of reach (ADR 0098, decision 18)", () => {
  test("its card stands where it was; line 3 says it after the machine; at work it sleeps, with nothing said it does", () => {
    const away = NOW - 12 * MINUTE
    const asks = card(row("turn", { away: true }, "arc"), {
      machine: arc,
      away,
    })
    expect(kinds(asks)).toEqual([
      "mark title | time",
      "says | ",
      "project | machine away harness",
    ])
    expect(asks.lines[2]!.right[1]).toEqual({ kind: "away", dot: true })
    expect([asks.stand, asks.tone]).toEqual(["turn", "attention"])
    expect(awayShort(asks.away!, NOW)).toBe("away 12m")
    // With no machine named, the words stand alone.
    const unnamed = card(row("turn", { away: true }, "arc"), { away })
    expect(unnamed.lines[2]!.right[0]).toEqual({ kind: "away", dot: false })
    // At work, its time stands as it went.
    const working = card(
      row("working", { mark: "working", away: true }, "arc"),
      { machine: arc, away }
    )
    expect(kinds(working)).toEqual([
      "mark title | time",
      "says | ",
      "project | machine away harness",
    ])
    expect(working.lines[0]!.left[0]).toEqual({ kind: "mark", look: "offline" })
    expect(working.does).toBeUndefined()
    expect(working.stand).toBe("working")
  })
})

describe("slots, by place and group", () => {
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

  test("grouped by Project, line 3 has no Project: its header names it", () => {
    const grouped = card(row("turn", {}, "arc"), {
      machine: arc,
      view: { group: "project", lines: 3 },
    })
    expect(kinds(grouped)).toEqual([
      "mark title | time",
      "says | ",
      " | machine harness",
    ])
  })

  test("a child's line 3 says ↳ and its parent in the Project's place, grouped by Project too, where it keeps its three lines (ADR 0098, decision 24)", () => {
    const child = { parent: "Ship the inbox" }
    const asks = card(row("turn", { parent: "t0" }), { child })
    expect(kinds(asks)).toEqual([
      "mark title | time",
      "says | ",
      "parent | harness",
    ])
    expect(asks.lines[2]!.left).toEqual([
      { kind: "parent", title: "Ship the inbox" },
    ])
    const grouped = card(row("turn", { parent: "t0" }), {
      child,
      view: { group: "project", lines: 3 },
    })
    expect(kinds(grouped)).toEqual(kinds(asks))
    // At work, it is a card under its parent.
    const under = card(row("working", { mark: "working", parent: "t0" }), {
      child: { ...child, under: true },
    })
    expect(kinds(under)).toEqual([
      "mark title | time",
      "works | ",
      "parent | harness",
    ])
    expect(under.child).toEqual({ parent: "Ship the inbox", under: true })
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
    ).toEqual(["mark title | time", "works | ", "project | machine harness"])
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

  test("with no lines changed, nothing on the right until the PR comes", () => {
    for (const mark of ["failed", "done", "asking"] as const)
      expect(says(row("turn", { mark })).right).toEqual([])
  })

  test("a Done card shows its last work's diff on the right, in grey; Failed shows nothing; at work, none (F1b)", () => {
    const changedLines = { added: 38, removed: 9 }
    const done = row("turn", { mark: "done", changedLines, calls: undefined })
    expect(says(done).right).toEqual([{ kind: "diff", added: 38, removed: 9 }])
    // Heard in words, not signs.
    expect(spokenOf(card(done, { place: "turn" }), NOW).description).toContain(
      "Done. 38 lines added, 9 removed"
    )
    expect(says(row("turn", { mark: "failed", changedLines })).right).toEqual(
      []
    )
    // At work, line 2 says what it does; the work since has no diff yet.
    const working = card(row("working", { mark: "working", changedLines }))
    expect(working.lines[1]).toEqual({ left: [{ kind: "works" }], right: [] })
  })

  test("a Thread that links a pull request shows its chip on the right in the diff's place: its number and how its checks stand; Failed shows nothing (F2)", () => {
    const changedLines = { added: 38, removed: 9 }
    const pulls = [pull(1061, { checks: "passing" })]
    const done = row("turn", { mark: "done", changedLines, pulls })
    expect(says(done).right).toEqual([
      { kind: "pull", number: 1061, of: 1, state: "passed" },
    ])
    expect(spokenOf(card(done, { place: "turn" }), NOW).description).toContain(
      "Pull request 1061, checks passed"
    )
    expect(says(row("turn", { mark: "failed", pulls })).right).toEqual([])
    // At work too: how its checks stand is not stale, as a diff is.
    const working = card(row("working", { mark: "working", pulls }))
    expect(working.lines[1]!.right).toEqual([
      { kind: "pull", number: 1061, of: 1, state: "passed" },
    ])
  })

  test("a pull request stands as its checks do, until it lands; one not read yet, or with no checks, has no glyph (F2)", () => {
    const state = (snapshot?: Partial<Snapshot>) =>
      pullStateOf(pull(1, snapshot))
    expect(state({ checks: "passing" })).toBe("passed")
    expect(state({ checks: "failing" })).toBe("failed")
    expect(state({ checks: "running" })).toBe("running")
    expect(state({ state: "merged", checks: "failing" })).toBe("merged")
    expect(state({ state: "closed" })).toBe("closed")
    expect(state({})).toBeUndefined()
    expect(pullStateOf({ ...pull(1), snapshot: undefined })).toBeUndefined()
    const unread = row("turn", {
      mark: "done",
      pulls: [{ ...pull(7), snapshot: undefined }],
    })
    expect(says(unread).right).toEqual([{ kind: "pull", number: 7, of: 1 }])
  })

  test("several pull requests show how many, with the glyph of the first, which most needs the Person (F2)", () => {
    const pulls = [
      pull(1063, { checks: "failing" }),
      pull(1061, { checks: "passing" }),
      pull(1062, { state: "merged" }),
    ]
    const done = row("turn", { mark: "done", pulls })
    const chip = says(done).right
    expect(chip).toEqual([
      { kind: "pull", number: 1063, of: 3, state: "failed" },
    ])
    expect(pullWords(chip[0] as PullChip)).toBe("3 PRs")
    expect(spokenOf(card(done, { place: "turn" }), NOW).description).toContain(
      "3 pull requests. Pull request 1063, checks failed"
    )
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
    const open = card(row("open", { mark: "idle", calls: undefined }))
    expect(open.lines[1]!.left).toEqual([
      { kind: "says", text: "fix the form" },
    ])
  })
})

describe("a working card's words (decision 8, spec §2.6; ADR 0099, decision 2)", () => {
  /** A working card of `more`, and its line 2's words. */
  const works = (more: Partial<Listed>) => {
    const one = card(row("working", { mark: "working", ...more }))
    expect(kinds(one)[1]).toBe("works | ")
    return worksWords(one.does!, NOW)
  }
  const doing = (
    what: NonNullable<Listed["doing"]>["what"],
    title?: string
  ): Partial<Listed> => ({
    doing: { what, since: NOW - MINUTE, ...(title ? { title } : {}) },
    stepped: NOW - MINUTE,
  })
  const at16 = new Date(2026, 10, 10, 16, 0).getTime()

  test("the first that applies: the limit, then silence, then compacting, then the doing", () => {
    const all = { ...doing("execute", "pnpm test"), compacting: true as const }
    expect(works({ ...all, limitUntil: at16, stepped: NOW - HOUR })).toBe(
      "Usage limit · goes on at 16:00"
    )
    expect(works({ ...all, stepped: NOW - 6 * MINUTE })).toBe(
      "No events for 6m"
    )
    expect(works(all)).toBe("Compacting the context")
    expect(works(doing("execute", "pnpm test"))).toBe("pnpm test")
  })

  test.each<[NonNullable<Listed["doing"]>["what"], string | undefined, string]>(
    [
      ["execute", "pnpm test", "pnpm test"],
      ["edit", "Row.tsx", "Edits Row.tsx"],
      ["read", "card.ts", "Reads card.ts"],
      ["search", "standOf", "Searches “standOf”"],
      ["fetch", "docs.rs", "Fetches docs.rs"],
      ["delete", "x", "Deletes x"],
      ["move", "x", "Moves x"],
      ["think", undefined, "Thinks"],
      ["reply", undefined, "Writes to you"],
      ["other", "Skill", "Skill"],
    ]
  )("%s %s says %s", (what, title, words) => {
    expect(works(doing(what, title))).toBe(words)
  })

  test("with nothing named yet, it says it works", () => {
    expect(works({})).toBe("Working")
    expect(works(doing("edit"))).toBe("Working")
  })

  test("its Mark shows what the words say: one doing, on the card, for both", () => {
    const one = card(
      row("working", { mark: "working", ...doing("delete", "x") })
    )
    expect(one.lines[0]!.left[0]).toEqual({ kind: "mark", look: "working" })
    expect(one.does).toEqual({ doing: "edit", kind: "delete", on: "x" })
    expect(card(row("turn")).does).toBeUndefined()
  })

  test("a card held in Your turn's three lines says what its Agent does now", () => {
    const held = card(
      row("working", { mark: "working", ...doing("execute", "pnpm test") }),
      { place: "turn" }
    )
    expect(kinds(held)[1]).toBe("works | ")
  })

  test("at the limit, line 1's right says when it goes on, on the clock", () => {
    const limited = card(row("working", { mark: "working", limitUntil: at16 }))
    expect(limited.time).toEqual({ kind: "ago", at: NOW - 14 * MINUTE })
    expect(timeShown(limited)).toEqual({ kind: "goes on", at: at16 })
    expect(spokenOf(limited, NOW)).toEqual({
      name: "Fix the form, Working, goes on at 16:00",
      description: "Usage limit. goes on at 16:00. banda. Claude Code",
    })
    const friday = new Date(2026, 10, 13, 9, 0).getTime()
    expect(
      spokenOf(
        card(row("working", { mark: "working", limitUntil: friday })),
        NOW
      ).name
    ).toBe("Fix the form, Working, goes on Friday at 9:00")
  })

  test("silence counts on the list's clock, and is said in full", () => {
    const stuck = card(
      row("working", { mark: "working", stepped: NOW - 6 * MINUTE })
    )
    expect(spokenOf(stuck, NOW).description).toBe(
      "No events for 6 minutes. banda. Claude Code"
    )
  })

  test("a card says what its Agent does to a screen reader once, as its Mark shows it", () => {
    const one = card(
      row("working", { mark: "working", ...doing("read", "card.ts") }, "arc"),
      { machine: arc }
    )
    expect(spokenOf(one, NOW).description).toBe(
      "Reads card.ts. banda. arc. Claude Code"
    )
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
    for (const mark of ["asking", "failed", "done"] as const) {
      const one = card(row("turn", { mark }, "arc"), { machine: arc })
      expect(JSON.stringify(one.lines)).not.toMatch(
        /tone|attention|destructive|added/
      )
    }
  })

  test("the small inbox's card has its machine, its time and its colour, as the sidebar's (#1067)", () => {
    const asking = row("turn")
    const here = card(asking, { at: atOf(asking) })
    expect(kinds(here)).toEqual([
      "mark title | time",
      "says | ",
      "project | harness",
    ])
    expect(here.time).toEqual({
      kind: "ago",
      at: NOW - 14 * MINUTE,
      tone: "attention",
    })
    const working = row(
      "working",
      { mark: "working", began: NOW - HOUR },
      "arc"
    )
    const there = card(working, { at: atOf(working), machine: arc })
    expect(kinds(there)).toEqual([
      "mark title | time",
      "works | ",
      "project | machine harness",
    ])
    expect(there.time).toEqual({ kind: "ago", at: NOW - HOUR })
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
      description: "Working. banda. arc. Claude Code",
    })
    const failed = card(
      row("turn", { mark: "failed", calls: "3 tests fail · #1061 ✗" })
    )
    expect(spokenOf(failed, NOW).description).toBe(
      "Failed 3 tests fail. #1061 failed. banda. Claude Code"
    )
  })

  test("a child adds who started it, once, its line 3 naming its parent (ADR 0098, decision 24)", () => {
    const child = { parent: "Ship the inbox" }
    const asks = card(row("turn", { parent: "t0" }), { child })
    expect(spokenOf(asks, NOW).description).toBe(
      "Asks Which port? Claude Code. Started by Ship the inbox"
    )
    const under = card(row("working", { mark: "working", parent: "t0" }), {
      child: { ...child, under: true },
    })
    expect(spokenOf(under, NOW).description).toBe(
      "Working. Claude Code. Started by Ship the inbox"
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
    // Put off by its Agent, it says so (ADR 0074).
    expect(later({ at: NOW, byAgent: true })).toBe(
      "Fix the form, Later by its Agent, when it's done"
    )
    expect(later({ at: NOW, until: at, byAgent: true })).toBe(
      "Fix the form, Later by its Agent, wakes at 18:30"
    )
    // Woke, it is no longer Later's: line 2 says who put it off.
    expect(
      card(
        row("turn", {
          later: {
            at: NOW - HOUR,
            byAgent: true,
            woke: { at: NOW, by: "time" },
          },
        })
      ).byAgent
    ).toBeUndefined()
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
      "now",
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
      description: "Working. banda. arc. Claude Code. arc is away, 12 minutes",
    })
    const stopped = card(row("working", { mark: "working" }, "arc"), {
      machine: arc,
      away: NOW - 12 * MINUTE,
      stopped: true,
    })
    expect(spokenOf(stopped, NOW).description).toBe(
      "Working. banda. arc. Claude Code. arc is stopped, 12 minutes"
    )
    const strayed = card(row("open", { mark: "idle", calls: undefined }), {
      strayed: true,
    })
    expect(spokenOf(strayed, NOW).description).toBe(
      "fix the form. banda. Claude Code. Away from its Project's workspace"
    )
  })
})

describe("a working card's line 2 says its sub-agents at work (ADR 0103, decision 32)", () => {
  const said = "3 sub-agents at work"
  const at = (more: Partial<Listed>) =>
    card(row("working", { mark: "working", ...more }))

  test("before what its turn does, as it says more", () => {
    const one = at({
      doing: { what: "execute", since: NOW - MINUTE, title: "pnpm test" },
      subagents: { working: 3, failed: 0, said },
    })
    expect(kinds(one)[1]).toBe("works | ")
    expect(workSaid(one, NOW)).toBe(said)
    expect(spokenOf(one, NOW).description).toBe(
      "3 sub-agents at work. banda. Claude Code"
    )
  })

  test("after its turn ended too, while they work on", () => {
    const one = at({
      subagents: { working: 1, failed: 0, said: "Waiting on Explore" },
    })
    expect(workSaid(one, NOW)).toBe("Waiting on Explore")
  })

  test("but a usage limit and silence come first: the work does not go on", () => {
    const subagents = { working: 2, failed: 0, said: "2 sub-agents at work" }
    expect(workSaid(at({ subagents, limitUntil: NOW + HOUR }), NOW)).toMatch(
      /^Usage limit/
    )
    expect(workSaid(at({ subagents, stepped: NOW - 6 * MINUTE }), NOW)).toBe(
      "No events for 6m"
    )
  })

  test("one that failed alone says nothing of its own: the card does not move (decision 29)", () => {
    const one = at({ subagents: { working: 0, failed: 1 } })
    expect(one.subagents).toBeUndefined()
    expect(workSaid(one, NOW)).toBe("Working")
    // A card that calls says its call, never its sub-agents.
    const done = card(
      row("turn", { mark: "done", subagents: { working: 1, failed: 0, said } })
    )
    expect(done.subagents).toBeUndefined()
  })
})
