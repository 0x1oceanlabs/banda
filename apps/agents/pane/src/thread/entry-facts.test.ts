/**
 * An entry is memoised on its item and facts (`entries/index.tsx`): while
 * the Agent writes, a fact draws again only the entries it changes, not
 * the whole Thread (ADR 0088, decision 9). These tests count, for each
 * fact, the entries whose props React's memo would see as new.
 */
import type { Event } from "@banda/contract"
import { expect, test } from "vitest"
import { event, person } from "../testing"
import { factsOf, knownOf } from "./entry-facts"
import { apply, EMPTY, type Listing, type ThreadState } from "./state"

const writers: Listing = { threads: new Map() }

/** One whole turn, `n` on its ids: the Person asks, the Agent thinks, runs
 * a call and replies. */
function turn(n: string): Event[] {
  const u = `u${n}`
  return [
    event(
      "message.posted",
      { item: `m${n}`, turn: u, text: `Ask ${n}`, images: [] },
      { author: person }
    ),
    event("turn.started", { turn: u }),
    event("thought.grew", { item: `t${n}`, turn: u, text: "Hm" }),
    event("tool.started", {
      item: `x${n}`,
      turn: u,
      title: "Run",
      tool: "execute",
      status: "pending",
    }),
    event("tool.changed", { item: `x${n}`, status: "done" }),
    event("reply.grew", { item: `r${n}`, turn: u, text: `Reply ${n}` }),
    event("turn.ended", { turn: u, state: "done" }),
  ]
}

/** 40 whole turns, 160 entries. The engine numbers its facts, and a
 * Thread takes none older than it has, so a test makes the facts of the
 * 41st turn after this. */
function long(): ThreadState {
  return Array.from({ length: 40 }, (_, n) => turn(`${n}`))
    .flat()
    .reduce(apply, EMPTY)
}

const play = (state: ThreadState, ...facts: Event[]) =>
  facts.reduce(apply, state)

/** What each entry is drawn with: its item and its facts. */
function props(state: ThreadState) {
  const of = factsOf(knownOf(state), writers)
  return new Map(state.items.map((item) => [item.id, { item, ...of(item) }]))
}

/** The entries `after` draws again: new ones, and those whose props are
 * not the same values, as memo compares them. */
function drawnAgain(before: ThreadState, after: ThreadState): string[] {
  const was = props(before)
  return [...props(after)].flatMap(([id, now]) => {
    const then = was.get(id)
    const keys = Object.keys({ ...then, ...now }) as (keyof typeof now)[]
    const same = then && keys.every((key) => Object.is(then[key], now[key]))
    return same ? [] : [id]
  })
}

test("while the Agent writes, each fact draws only the entry it changes", () => {
  const done = long()
  const [asked, started] = turn("")
  const state = play(done, asked, started)
  expect(state.items).toHaveLength(161)
  const grew = (kind: string, item: string, text: string) =>
    event(kind, { item, turn: "u", text })
  // In the order the engine sends them: an array is made in order.
  const steps: [Event, string[]][] = [
    // A new entry is drawn, and the one before it is no longer live.
    [grew("thought.grew", "t", "Hm"), ["m", "t"]],
    [grew("thought.grew", "t", "m."), ["t"]],
    [
      event("tool.started", {
        item: "x",
        turn: "u",
        title: "Run",
        tool: "execute",
        status: "pending",
      }),
      ["t", "x"],
    ],
    [event("tool.output", { item: "x", text: "one\n", cut: false }), ["x"]],
    [event("tool.changed", { item: "x", status: "done" }), ["x"]],
    [grew("reply.grew", "r", "Let"), ["x", "r"]],
    [grew("reply.grew", "r", "'s see"), ["r"]],
  ]
  steps.reduce((before, [fact, drawn]) => {
    const after = apply(before, fact)
    expect(drawnAgain(before, after), fact.kind).toEqual(drawn)
    return after
  }, state)
})

test("a turn that ends draws again only what it may now be forked or edited from", () => {
  const done = long()
  const [asked, started, thought, call, called, reply, ended] = turn("")
  const state = play(done, asked, started, thought, call, called, reply)
  // Every reply may be forked from and every Person's message edited from
  // again, so those are drawn again, once at the turn's end, and the live
  // turn's call, which shows how its turn stands. No other thought or
  // call is.
  expect(drawnAgain(state, apply(state, ended))).toEqual(
    state.items
      .filter((item) => /^[mr]\d*$/.test(item.id) || item.id === "x")
      .map((item) => item.id)
  )
})
