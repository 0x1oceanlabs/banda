/**
 * A key is drawn before the engine answers (ADR 0088, decision 11): the
 * Tiling draws the facts it heard of the arrangement with the commands it
 * sent and has not heard yet applied over them, in the order sent, by the
 * client's copy of the engine's commands (`arrangement.ts`). Each command
 * is applied under its CommandId, the seed of every ID it makes, so a
 * Pane it opens has the ID the engine gives it: drawn again from the
 * facts, it stays the same Tile, its terminal and its page with it.
 *
 * A command leaves the queue as soon as the facts hold what it did:
 *
 * 1. answered as one that changed nothing (`at` none): at once;
 * 2. heard: the facts heard stand at or past its `at`;
 * 3. a later one heard: a session's commands to one scope commit in the
 *    order sent (ADR 0082, decision 4), so those before it are in the
 *    facts too;
 * 4. its fact heard before its answer: the fewest commands at the
 *    queue's head that, applied to the facts before, give the facts now;
 * 5. refused: at once, and the drawing goes back to the facts with the
 *    others applied over them;
 * 6. given up, as the engine never answered it.
 *
 * What is left is applied again over each new fact, one from elsewhere
 * too (an Agent's placement, another device). A command applied again
 * over the facts that hold it changes nothing more: one that makes
 * something is refused there, as what it makes is there already, and the
 * others set what they set again. All but `regroup`, which steps a column
 * once more: rule 4 takes it out where it can, and its answer does the
 * rest.
 *
 * Pure, so plain tests cover it; `useTiling.ts` keeps it in a store.
 */
import type { CommandId } from "@banda/contract"
import type { Workspace as Kept } from "@banda/contract/workspaces"
import {
  type Asked,
  NO_VIEW,
  resolve,
  type View,
  viewOf,
  type Want,
  withAsked,
} from "./arrange"
import { apply, type Command } from "./arrangement"
import { sameData, sameEach } from "@banda/ui/lib/store"
import {
  type Column,
  type Entry,
  entries,
  type Workspace,
  type Workspaces,
} from "./model"

/** A command sent whose fact is not heard yet. */
export type Unheard = {
  id: CommandId
  command: Command
  /** Where its event stands in the log, once the engine said. */
  at?: number
}

/** What the Tiling has heard, what it has sent, and what it draws of them. */
export type Seen = {
  /** The engine's arrangement, as the facts heard have it; none until it
   * was read. */
  heard: Kept[] | null
  /** Where in the machine's log `heard` stands. */
  heardAt: number
  /** The commands sent whose facts are not heard yet, in the order sent. */
  unheard: readonly Unheard[]
  /** `heard` with each command of `unheard` applied, in order. */
  predicted: Kept[] | null
  /** Args Panes asked for, drawn over `predicted` until the log shows
   * them. */
  asked: Asked
  /** The highest place in the log the engine answered this window with:
   * the facts heard there hold all it answered. */
  answered: number
  view: View
  /** What the window draws: `predicted`, with the args asked for, as the
   * view looks at it. */
  state: Workspaces
  /** `heard` alone, drawn. */
  heardState: Workspaces
  /** The Panes that stand: the engine's, and those the window draws. A
   * Pane leaves only once it is in neither, so its App lets go of it as
   * the facts say, or once a Pane the window drew is refused. */
  standing: Workspaces
}

/** What the window draws while the engine's arrangement is read. */
export const WAITING: Workspaces = {
  list: [{ id: "", columns: [], focus: 0 }],
  current: 0,
}

/** Nothing heard and nothing sent yet, looking as `view`. */
export function unseen(view: View): Seen {
  return {
    heard: null,
    heardAt: 0,
    unheard: [],
    predicted: null,
    asked: {},
    answered: 0,
    view,
    state: WAITING,
    heardState: WAITING,
    standing: WAITING,
  }
}

/** A change for the engine, as a key works it out (`arrange.ts`'s `Plan`):
 * its command, and the Pane to focus once it is drawn; a Pane opened is
 * focused by the ID the command gives it, unless `focus` is false. */
type Planned = { command: Command; want?: string; focus?: false }

/**
 * `plan` sent under `id`, drawn at once: its command applied over what is
 * drawn now. A command the copy refuses draws nothing, and waits for the
 * engine's answer all the same. Gives the Pane it focuses, if any, and the
 * one it opens, by the ID the engine gives it too.
 */
export function predict(
  seen: Seen,
  id: CommandId,
  plan: Planned
): { seen: Seen; want?: string; opens?: string } {
  const unheard = [...seen.unheard, { id, command: plan.command }]
  const applied = seen.predicted && applyOne(seen.predicted, unheard.at(-1)!)
  const predicted = applied ? applied.list : seen.predicted
  const want =
    plan.focus === false ? undefined : (plan.want ?? applied?.answer.pane)
  const view = want
    ? { ...seen.view, want: { pane: want, command: id } }
    : seen.view
  const opens = applied?.answer.pane
  return { seen: drawn({ ...seen, unheard, predicted, view }), want, opens }
}

/**
 * The engine answered command `id`, its event at `at` in the log, or none
 * when it changed nothing: it leaves the queue once the facts reach `at`,
 * or at once. One no longer in the queue is let be.
 */
export function answered(seen: Seen, id: CommandId, at: number | null): Seen {
  const highest = Math.max(seen.answered, at ?? 0)
  const i = seen.unheard.findIndex((one) => one.id === id)
  if (i < 0) return answeredTo(seen, at)
  const unheard =
    at === null
      ? seen.unheard.filter((_, j) => j !== i)
      : seen.unheard.map((one, j) => (j === i ? { ...one, at } : one))
  return settled({ ...seen, unheard, answered: highest })
}

/** The engine answered this window as far as `at` in the log, or changed
 * nothing: a Pane's args, which go outside the queue. */
export function answeredTo(seen: Seen, at: number | null): Seen {
  const highest = Math.max(seen.answered, at ?? 0)
  return highest === seen.answered ? seen : { ...seen, answered: highest }
}

/**
 * Command `id` is out of the queue, refused by the engine or given up as
 * it never answered: the window draws the facts again, with the commands
 * after it applied over them. What it drew of it alone goes; a Pane it
 * opened leaves `standing` with it.
 */
export function dropped(seen: Seen, id: CommandId): Seen {
  if (!seen.unheard.some((one) => one.id === id)) return seen
  const unheard = seen.unheard.filter((one) => one.id !== id)
  return settled({ ...seen, unheard })
}

/**
 * The facts heard now: the engine's arrangement as the log stands at
 * `at`. The commands they hold leave the queue, and the rest are applied
 * over them again.
 */
export function hear(seen: Seen, heard: Kept[], at: number): Seen {
  if (heard === seen.heard && at === seen.heardAt) return seen
  // Rule 4: the shortest run of the queue's head that comes to these
  // facts from those before, its answers still on their way; none when
  // they say what those before did, as a read again does. Not the
  // longest: commands that undo each other, as a column maximized and
  // then not, come back to the facts before them, and taking the first's
  // fact for all would draw without the others until their facts come.
  // With none unheard there is nothing to look for.
  let held = 0
  const now = seen.heard && seen.unheard.length > 0 && text(heard)
  if (seen.heard && now && now !== text(seen.heard)) {
    let list = seen.heard
    for (const [i, one] of seen.unheard.entries()) {
      list = applyOne(list, one)?.list ?? list
      if (text(list) !== now) continue
      held = i + 1
      break
    }
  }
  const unheard = held ? seen.unheard.slice(held) : seen.unheard
  const heardState = resolve(
    heard,
    NO_VIEW,
    seen.heard ? seen.heardState : undefined
  )
  return settled({ ...seen, heard, heardAt: at, unheard, heardState })
}

/** The view alone changed: the same facts and commands, drawn as `view`
 * looks at them. */
export function look(seen: Seen, view: View): Seen {
  return drawn({ ...seen, view })
}

/** Pane `pane` asked for `args`, drawn until the log stands at `until`:
 * `Infinity` until the engine says where. */
export function ask(
  seen: Seen,
  pane: string,
  args: unknown,
  until: number
): Seen {
  return drawn({ ...seen, asked: { ...seen.asked, [pane]: { args, until } } })
}

/** The commands the facts hold out of the queue (rules 2 and 3), the rest
 * applied over the facts, and drawn. */
function settled(seen: Seen): Seen {
  let last = -1
  for (const [i, one] of seen.unheard.entries())
    if (one.at !== undefined && one.at <= seen.heardAt) last = i
  const unheard = last < 0 ? seen.unheard : seen.unheard.slice(last + 1)
  const predicted =
    seen.heard &&
    unheard.reduce<Kept[]>(
      (list, one) => applyOne(list, one)?.list ?? list,
      seen.heard
    )
  return drawn({ ...seen, unheard, predicted })
}

/** `one` applied to `list`; none when the copy refuses it. */
function applyOne(list: Kept[], one: Unheard) {
  const applied = apply(list, one.command, one.id)
  return "refused" in applied ? undefined : applied
}

/** What `seen` draws: `predicted`, with the args asked for, as the view
 * looks at it. What is drawn the same stays the same object, so what did
 * not change draws nothing again. */
function drawn(seen: Seen): Seen {
  if (!seen.predicted) return seen
  const { kept, asked } = withAsked(seen.predicted, seen.asked, seen.heardAt)
  const state = resolve(kept, seen.view, seen.state, seen.heardAt)
  const want = seen.view.want
  const next = viewOf(state)
  if (want && wanted(want, state, seen)) next.want = want
  const view = sameView(next, seen.view) ? seen.view : next
  const standing = standingOf(seen.heardState, state, seen.standing)
  return { ...seen, asked, state, view, standing }
}

/** Whether the view still aims at `want`: while the command that wants it
 * waits, or, as a window kept it before, until the log stands past
 * `after` and it is drawn. */
function wanted(want: Want, state: Workspaces, seen: Seen): boolean {
  if (want.command !== undefined)
    return seen.unheard.some((one) => one.id === want.command)
  const shown = entries(state).some((entry) => entry.id === want.pane)
  return seen.heardAt < (want.after ?? 0) || !shown
}

/** The engine's Panes, and after them those the window draws otherwise,
 * for what follows which leave: each once. A Pane drawn with args it
 * asked for stands as it is drawn too, as its App runs it so: a terminal
 * that took its ID before the engine heard of it keeps its program.
 * `before` while it holds the same. */
function standingOf(
  heard: Workspaces,
  state: Workspaces,
  before: Workspaces
): Workspaces {
  const engine = new Map(entries(heard).map((entry) => [entry.id, entry]))
  const drawn = entries(state).filter((entry) => {
    const there = engine.get(entry.id)
    return (
      !there ||
      there.project !== entry.project ||
      !sameData(there.pane, entry.pane)
    )
  })
  const list = drawn.length
    ? [...heard.list, { id: "", columns: [column(drawn)], focus: 0 }]
    : heard.list
  const last = before.list.at(-1)
  const was = last?.id === "" ? last.columns[0]?.entries : undefined
  const same = (workspace: Workspace, i: number) =>
    workspace === before.list[i] ||
    (i === heard.list.length && was !== undefined && sameEach(drawn, was))
  if (before.list.length === list.length && list.every(same)) return before
  return { list, current: 0 }
}

function column(drawn: Entry[]): Column {
  return { id: "", entries: drawn, active: 0 }
}

function sameView(a: View, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * `value` as JSON text with the keys of each object in order, and each
 * array's in its own: two arrangements are the same when they say the
 * same, whatever order their fields were written in, and a field one has
 * and the other lacks sets them apart.
 */
export function text(value: unknown): string {
  return JSON.stringify(ordered(value))
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== "object" || value === null) return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, ordered(object[key])])
  )
}

/** How long a command may go unanswered while the engine is connected
 * before the Tiling stops drawing it (rule 6): as long as the engine lets
 * one hold up its queue before the next goes beside it (`HOLDS_UP`,
 * kernel/src/api.rs). */
export const ANSWER_WITHIN = 30_000

/**
 * The commands that wait for their answer, each with a clock that runs
 * only while the engine is connected: a sleep, an engine that restarts or
 * updates, or an ssh connection that drops gives up on none, as the
 * client sends them again once it is back. A command answered waits for
 * its fact with no clock at all: the log holds it, and a window that
 * missed it reads the arrangement again. A window hidden, which hears no
 * fact while its ticks stop, gives up on none either.
 */
export class Unanswered {
  readonly #waiting = new Map<
    CommandId,
    ReturnType<typeof setTimeout> | undefined
  >()
  readonly #gaveUp: (id: CommandId) => void
  #connected = false

  constructor(gaveUp: (id: CommandId) => void) {
    this.#gaveUp = gaveUp
  }

  /** Command `id` was sent: its clock runs while the engine is
   * connected. */
  sent(id: CommandId): void {
    this.#waiting.set(id, this.#connected ? this.#clock(id) : undefined)
  }

  /** Command `id` was answered, refused or given up: its clock stops. */
  done(id: CommandId): void {
    clearTimeout(this.#waiting.get(id))
    this.#waiting.delete(id)
  }

  /** The engine is connected or not: the clocks run, each from the
   * start, as their commands go again, or they stop. */
  connected(connected: boolean): void {
    if (connected === this.#connected) return
    this.#connected = connected
    for (const [id, clock] of this.#waiting) {
      clearTimeout(clock)
      this.#waiting.set(id, connected ? this.#clock(id) : undefined)
    }
  }

  /** Stops every clock, for good. */
  stop(): void {
    for (const clock of this.#waiting.values()) clearTimeout(clock)
    this.#waiting.clear()
  }

  #clock(id: CommandId) {
    return setTimeout(() => {
      this.#waiting.delete(id)
      this.#gaveUp(id)
    }, ANSWER_WITHIN)
  }
}
