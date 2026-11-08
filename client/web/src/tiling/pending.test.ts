/**
 * The Tiling draws a key at once (ADR 0088, decision 11): what it draws
 * of the commands it sent, and how each leaves its queue. The golden
 * traces of `parity.test.ts` are replayed here as a window lives them:
 * every command sent at once, then their facts heard one by one, each
 * after its answer or before it.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type CommandId, newId } from "@banda/contract"
import type { Workspace as Kept } from "@banda/contract/workspaces"
import { afterEach, describe, expect, test, vi } from "vitest"
import { keptOf, NO_VIEW } from "./arrange"
import { apply, type Command } from "./arrangement"
import { entries, focused } from "./model"
import {
  ANSWER_WITHIN,
  answered,
  ask,
  dropped,
  hear,
  look,
  predict,
  type Seen,
  text,
  Unanswered,
  unseen,
} from "./pending"

const PROJECT = "a0000000-0000-4000-8000-000000000001"
const START: Kept[] = [
  { id: "a187da52-75f3-5bac-bdad-744f8b5abb09", columns: [] },
]

const opening = (n: number): Command => ({
  method: "workspaces.open",
  params: { project: PROJECT, kind: "a.a", args: { n } },
})

/** `list` after each command, as the engine runs it under its ID. */
function ran(list: Kept[], ...commands: [CommandId, Command][]): Kept[] {
  return commands.reduce((now, [id, command]) => {
    const applied = apply(now, command, id)
    if ("refused" in applied) throw new Error(applied.message)
    return applied.list
  }, list)
}

/** Three Panes, each a column of its own, heard at 3. */
function three(): { seen: Seen; list: Kept[] } {
  const list = ran(
    START,
    [newId(), opening(1)],
    [newId(), opening(2)],
    [newId(), opening(3)]
  )
  return { seen: hear(unseen(NO_VIEW), list, 3), list }
}

const columnsOf = (list: Kept[]) => list[0].columns

describe("a key drawn before the engine answers", () => {
  test("a burst draws each command over the one before, as the engine will run them", () => {
    const { seen: before, list } = three()
    const [first, second] = columnsOf(list)
    const sent: [CommandId, Command][] = [
      [newId(), opening(4)],
      [
        newId(),
        {
          method: "workspaces.size",
          params: { column: first.id, width: "1/3" },
        },
      ],
      [
        newId(),
        {
          method: "workspaces.maximize",
          params: { column: second.id, full: true },
        },
      ],
      [newId(), opening(5)],
      [
        newId(),
        { method: "workspaces.close", params: { pane: first.panes[0].id } },
      ],
    ]
    let seen = before
    let want: string | undefined
    for (const [id, command] of sent) {
      ;({ seen, want } = predict(seen, id, { command }))
    }
    expect(text(seen.predicted)).toBe(text(ran(list, ...sent)))
    expect(text(keptOf(seen.state))).toBe(text(ran(list, ...sent)))
    expect(seen.pending.map((one) => one.id)).toEqual(sent.map(([id]) => id))
    // A Pane opened is focused by the ID the engine will give it.
    const opened = ran(list, ...sent.slice(0, 4))[0].columns.at(-1)!.panes[0]
    expect(want).toBeUndefined()
    expect(seen.view.want).toEqual({ pane: opened.id, command: sent[3][0] })
    expect(focused(seen.state)?.id).toBe(opened.id)
  })

  test("a command answered as one that changed nothing leaves at once", () => {
    const { seen: before, list } = three()
    const column = columnsOf(list)[0].id
    const id = newId()
    const size = { method: "workspaces.size", params: { column } } as const
    const { seen } = predict(before, id, { command: size })
    expect(seen.pending).toHaveLength(1)
    const after = answered(seen, id, null)
    expect(after.pending).toEqual([])
    expect(after.state).toBe(seen.state)
  })

  test("its fact heard before its answer, a command leaves as its fact holds it: a regroup steps once", () => {
    const { list } = three()
    const [, middle] = columnsOf(list)
    const grouped = ran(list, [
      newId(),
      { method: "workspaces.group", params: { column: middle.id } },
    ])
    const seen = hear(unseen(NO_VIEW), grouped, 4)
    const id = newId()
    const regroup: Command = {
      method: "workspaces.regroup",
      params: { column: columnsOf(grouped)[0].id, toward: "right" },
    }
    const predicted = predict(seen, id, { command: regroup }).seen
    const once = ran(grouped, [id, regroup])
    // Applied again over its own fact, it would step once more.
    expect(text(ran(once, [newId(), regroup]))).not.toBe(text(once))
    const heard = hear(predicted, once, 5)
    expect(heard.pending).toEqual([])
    expect(text(heard.predicted)).toBe(text(once))
    // Its answer then finds it gone, and changes nothing.
    expect(answered(heard, id, 5).predicted).toBe(heard.predicted)
  })

  test("a fact from elsewhere is drawn under the commands that wait", () => {
    const { seen: before, list } = three()
    const column = columnsOf(list)[2].id
    const id = newId()
    const width: Command = {
      method: "workspaces.size",
      params: { column, width: "1/3" },
    }
    const waiting = predict(before, id, { command: width }).seen
    // An Agent opens a Pane meanwhile; the engine runs it first.
    const agent: [CommandId, Command] = [newId(), opening(9)]
    const theirs = ran(list, agent)
    const rebased = hear(waiting, theirs, 4)
    expect(rebased.pending.map((one) => one.id)).toEqual([id])
    expect(text(rebased.predicted)).toBe(text(ran(theirs, [id, width])))
    // Then the window's fact, answered first: as drawn, nothing draws
    // again.
    const done = hear(answered(rebased, id, 5), ran(theirs, [id, width]), 5)
    expect(done.pending).toEqual([])
    expect(done.state).toBe(rebased.state)
  })

  test("a refusal draws the facts again, with the other commands over them", () => {
    const { seen: before, list } = three()
    const [first, , last] = columnsOf(list)
    const maximize: [CommandId, Command] = [
      newId(),
      {
        method: "workspaces.maximize",
        params: { column: first.id, full: true },
      },
    ]
    const width: [CommandId, Command] = [
      newId(),
      { method: "workspaces.size", params: { column: last.id, width: "1/3" } },
    ]
    let seen = before
    for (const [id, command] of [maximize, width])
      seen = predict(seen, id, { command }).seen
    expect(columnsOf(seen.predicted!)[0].full).toBe(true)
    const back = dropped(seen, maximize[0])
    expect(text(back.predicted)).toBe(text(ran(list, width)))
    expect(back.pending.map((one) => one.id)).toEqual([width[0]])
    // A Pane opened, refused, leaves what stands: its App lets it go.
    const id = newId()
    const open = predict(back, id, { command: opening(7) })
    const pane = open.want!
    const ids = (seen: Seen) =>
      seen.standing.list.flatMap((w) =>
        w.columns.flatMap((c) => c.entries.map((e) => e.id))
      )
    // Each Pane stands once, the engine's and the window's alike.
    expect(ids(open.seen).sort()).toEqual(
      [...entries(open.seen.heardState).map((e) => e.id), pane].sort()
    )
    const refused = dropped(open.seen, id)
    expect(ids(refused)).not.toContain(pane)
    expect(refused.view.want).toBeUndefined()
  })

  test("a Pane that asked for its args before the engine had it stands as drawn until the engine has them", () => {
    const { seen: before, list } = three()
    const id = newId()
    const open = opening(9)
    const { seen: opened, want: pane } = predict(before, id, { command: open })
    // Its App gives it an ID of its own, as a terminal does, at once.
    const asked = ask(opened, pane!, { n: 9, terminal: "t" }, Infinity)
    const standing = (seen: Seen) =>
      entries(seen.standing).filter((entry) => entry.id === pane)
    // The open's fact has the args it opened with: the args asked for
    // stand still, so what follows which leave lets go of nothing.
    const heard = hear(answered(asked, id, 4), ran(list, [id, open]), 4)
    expect(standing(heard).map((entry) => entry.pane.args)).toEqual([
      { n: 9 },
      { n: 9, terminal: "t" },
    ])
    // Once the engine has them, it stands once.
    const kept = ran(list, [id, open]).map((workspace) => ({
      ...workspace,
      columns: workspace.columns.map((column) => ({
        ...column,
        panes: column.panes.map((one) =>
          one.id === pane ? { ...one, args: { n: 9, terminal: "t" } } : one
        ),
      })),
    }))
    const updated = hear(ask(heard, pane!, { n: 9, terminal: "t" }, 5), kept, 5)
    expect(standing(updated).map((entry) => entry.pane.args)).toEqual([
      { n: 9, terminal: "t" },
    ])
  })

  test("a later command's fact takes those before it out too, as they commit in the order sent", () => {
    const { seen: before, list } = three()
    const [a, b, c] = columnsOf(list)
    const sent: [CommandId, Command][] = [a, b, c].map((column, i) => [
      newId(),
      {
        method: "workspaces.size",
        params: { column: column.id, width: ["1/3", "1/2", "2/3"][i] },
      },
    ])
    let seen = before
    for (const [id, command] of sent) seen = predict(seen, id, { command }).seen
    // Only the last is answered when the facts come, with a fact from
    // elsewhere among them: rule 4 finds no run, the place does.
    seen = answered(seen, sent[2][0], 12)
    const facts = ran(list, [newId(), opening(8)], ...sent)
    const heard = hear(seen, facts, 12)
    expect(heard.pending).toEqual([])
    expect(text(heard.predicted)).toBe(text(facts))
  })

  test("a fact the same as what is drawn keeps it the same object, so nothing draws again", () => {
    const { seen: before, list } = three()
    const id = newId()
    const width: Command = {
      method: "workspaces.size",
      params: { column: columnsOf(list)[1].id, width: "1/2" },
    }
    const seen = predict(before, id, { command: width }).seen
    const heard = hear(answered(seen, id, 4), ran(list, [id, width]), 4)
    expect(heard.state).toBe(seen.state)
    expect(heard.view).toBe(seen.view)
    // What stands is what the engine has: the window draws nothing else.
    expect(heard.standing.list).toBe(heard.heardState.list)
  })

  test("the view alone changes what is looked at, and cancels the Pane a command wanted", () => {
    const { seen: before } = three()
    const id = newId()
    const { seen } = predict(before, id, { command: opening(4) })
    expect(seen.view.want?.command).toBe(id)
    const looked = look(seen, { ...seen.view, want: undefined })
    expect(looked.view.want).toBeUndefined()
    expect(looked.pending).toHaveLength(1)
  })

  test("args a Pane asked for are drawn until the log stands where the engine kept them", () => {
    const { seen: before, list } = three()
    const pane = columnsOf(list)[0].panes[0].id
    const asked = ask(before, pane, { n: 10 }, Infinity)
    expect(asked.state.list[0].columns[0].entries[0].pane.args).toEqual({
      n: 10,
    })
    const kept = ask(asked, pane, { n: 10 }, 5)
    const updated = ran(list, [
      newId(),
      { method: "workspaces.update", params: { pane, args: { n: 10 } } },
    ])
    const heard = hear(kept, updated, 5)
    expect(heard.asked).toEqual({})
    expect(heard.state.list[0].columns[0].entries[0].pane.args).toEqual({
      n: 10,
    })
  })
})

describe("a command the engine never answers", () => {
  afterEach(() => vi.useRealTimers())

  test("is given up after its time unanswered, counted only while the engine is connected", () => {
    vi.useFakeTimers()
    const gaveUp: string[] = []
    const clock = new Unanswered((id) => gaveUp.push(id))
    clock.connected(true)
    clock.sent("a")
    clock.sent("b")
    clock.done("b")
    vi.advanceTimersByTime(ANSWER_WITHIN - 1)
    expect(gaveUp).toEqual([])
    // The engine goes away: no clock runs, however long.
    clock.connected(false)
    clock.sent("c")
    vi.advanceTimersByTime(10 * ANSWER_WITHIN)
    expect(gaveUp).toEqual([])
    // Back, each runs from its start, as each goes again.
    clock.connected(true)
    vi.advanceTimersByTime(ANSWER_WITHIN)
    expect(gaveUp).toEqual(["a", "c"])
    clock.stop()
  })
})

type Step = {
  method: Command["method"]
  seed: string
  params: unknown
  refused?: string
  after: Kept[]
}
type Trace = { about: string; start: Kept[]; steps: Step[] }

const folder = join(
  import.meta.dirname,
  "../../../../platform/workspaces/traces"
)
const traces: [string, Trace][] = readdirSync(folder)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => [
    name,
    JSON.parse(readFileSync(join(folder, name), "utf8")) as Trace,
  ])

describe.each(traces)("%s, as a window lives it", (_, trace) => {
  /** Every step sent at once, over the trace's start heard at 0. */
  function sentAll(): Seen {
    let seen = hear(unseen(NO_VIEW), trace.start, 0)
    for (const step of trace.steps) {
      const command = { method: step.method, params: step.params } as Command
      seen = predict(seen, step.seed, { command, focus: false }).seen
    }
    return seen
  }
  const last = text(trace.steps.at(-1)!.after)

  test("drawn whole at once, then each fact heard after its answer", () => {
    let seen = sentAll()
    expect(text(seen.predicted)).toBe(last)
    for (const [i, step] of trace.steps.entries()) {
      if (step.refused !== undefined) seen = dropped(seen, step.seed)
      else seen = hear(answered(seen, step.seed, i + 1), step.after, i + 1)
      expect(text(seen.predicted), `after step ${i + 1}`).toBe(last)
    }
    expect(seen.pending).toEqual([])
  })

  test("drawn whole at once, then each fact heard before its answer", () => {
    let seen = sentAll()
    let before = text(trace.start)
    let head = 0
    for (const [i, step] of trace.steps.entries()) {
      // One the engine refused writes no fact, nor one that changed
      // nothing: their answers tell, the second's at the log's head.
      const now = text(step.after)
      if (step.refused !== undefined) seen = dropped(seen, step.seed)
      else if (now === before) seen = answered(seen, step.seed, head)
      else seen = hear(seen, step.after, (head = i + 1))
      before = now
      expect(text(seen.predicted), `after step ${i + 1}`).toBe(last)
    }
    expect(seen.pending).toEqual([])
  })
})
