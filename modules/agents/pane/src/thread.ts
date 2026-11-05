/**
 * A Thread as a Pane holds it: the view it loaded, then each fact applied in
 * the log's order (ADR 0002, decision 5). Pure, so plain tests cover it.
 */
import type { Event } from "@banda/contract"
import {
  decodeFact,
  type Body,
  type Can,
  type HarnessOption,
  type Item,
  type ListedThread,
  type Offer,
  type OptionValue,
  type Settings,
  type ThreadView,
  type TurnView,
  type Usage,
} from "@banda/contract/agents"
import { settledTurn } from "./marks"

export type ThreadState = {
  /** The last position in the Project's log this state includes. */
  at: number
  /** The start of its first message, until its Person renames it. */
  title: string
  /** The Harness it runs on, by its ID. */
  harness: string
  items: Item[]
  turns: TurnView[]
  settings: Settings
  offer: Offer
  /** How full the Agent's context is, once the Harness has said. */
  usage?: Usage
  /** Its queue waits for a Person: a stop or a restart held it. */
  held: boolean
  /** The Thread it was forked from, by its ID, if it was. */
  forkedFrom?: string
}

/** What a Thread runs with when nobody chose otherwise, as the engine has it. */
export const DEFAULT_SETTINGS: Settings = {
  mode: "full_access",
  plan: false,
  options: {},
}

export const NO_OFFER: Offer = {
  options: [],
  plans: false,
  slash_commands: [],
  skills: [],
  no_images: false,
}

export const EMPTY: ThreadState = {
  at: 0,
  title: "",
  harness: "",
  items: [],
  turns: [],
  settings: DEFAULT_SETTINGS,
  offer: NO_OFFER,
  held: false,
}

export function fromView(view: ThreadView): ThreadState {
  const { at, items, turns, settings, offer, usage, held } = view
  const { title, harness } = view.thread
  const forkedFrom = view.forked_from
  return {
    at,
    title,
    harness,
    items,
    turns,
    settings,
    offer,
    usage,
    held,
    forkedFrom,
  }
}

/** The value a Thread runs `option` with: its own choice, or else the
 * Harness's. */
export function chosen(settings: Settings, option: HarnessOption): OptionValue {
  return settings.options[option.id] ?? option.value
}

/** `settings` with `option` set to `value`. */
export function choose(
  settings: Settings,
  option: string,
  value: OptionValue
): Settings {
  return { ...settings, options: { ...settings.options, [option]: value } }
}

function changeItem(
  state: ThreadState,
  id: string,
  change: (item: Item) => Item
): Item[] {
  return state.items.map((item) => (item.id === id ? change(item) : item))
}

/** A tool call as the Thread shows it. */
export type Tool = Extract<Body, { kind: "tool" }>

/** A Question the Agent asks, as the Thread shows it. */
export type QuestionBody = Extract<Body, { kind: "question" }>

export type IssueBody = Extract<Body, { kind: "issue" }>

/** An item that is a Question. */
export type Asked = Item & { body: QuestionBody }

function changeTool(
  state: ThreadState,
  id: string,
  change: (tool: Tool) => Tool
): Item[] {
  return changeItem(state, id, (item) =>
    item.body.kind === "tool" ? { ...item, body: change(item.body) } : item
  )
}

/** The items with `id` after every other, changed by `change`. */
/** `items` with `moved` after every other, in place of the item it
 * replaces, if there is one. */
function moveLast(items: Item[], moved: Item): Item[] {
  return [...items.filter((item) => item.id !== moved.id), moved]
}

/** The turn that first ran or will run `message`. A turn a Person took
 * back never ran it. */
export function firstTurnOf(
  turns: TurnView[],
  message: string
): TurnView | undefined {
  return turns.find(
    (turn) => turn.message === message && turn.state !== "withdrawn"
  )
}

function changeTurn(
  state: ThreadState,
  id: string,
  change: Partial<TurnView>
): TurnView[] {
  return state.turns.map((turn) =>
    turn.id === id ? { ...turn, ...change } : turn
  )
}

/** The state after `event`. An event this Pane does not know changes nothing. */
export function apply(state: ThreadState, event: Event): ThreadState {
  const next = project(state, event)
  return next.turns === state.turns && next.held === state.held
    ? next
    : withCan(next)
}

/**
 * What a Person may do with each turn, as the engine's rules say
 * (`rules::can`, ADR 0014, decision 2). The engine's view carries it; after
 * a fact the Pane works it out again, and the checkpoints keep the two
 * equal. A turn whose `can` stays the same stays the same object.
 */
function withCan(state: ThreadState): ThreadState {
  const notices = new Set(
    state.items
      .filter((item) => item.body.kind === "notice")
      .map((item) => item.id)
  )
  const counted = state.turns.filter((turn) => turn.state !== "withdrawn")
  const begun = counted.findLast((turn) => turn.state !== "queued")?.id
  const works = state.turns.some((turn) => turn.state === "running")
  const anyWaits = state.turns.some((turn) => turn.state === "queued")
  // The messages a Person wrote, not an Agent.
  const persons = new Set(
    state.items
      .filter((item) => item.author.kind === "person")
      .map((item) => item.id)
  )
  const turns = state.turns.map((turn) => {
    const its = counted.filter((t) => t.message === turn.message)
    const byItself = notices.has(turn.message)
    const waits = turn.state === "queued"
    const fork = !works && !waits && turn.state !== "withdrawn"
    const can: Can = {
      stop: waits || turn.state === "running",
      retry:
        !byItself &&
        (turn.state === "failed" || turn.state === "interrupted") &&
        begun === turn.id &&
        its.at(-1)?.id === turn.id,
      edit: waits && its[0]?.id === turn.id,
      withdraw: waits,
      steer: turn.state === "running" && !state.held && !byItself,
      fork,
      rewind:
        fork &&
        !anyWaits &&
        persons.has(turn.message) &&
        its[0]?.id === turn.id,
    }
    const same = (Object.keys(can) as (keyof Can)[]).every(
      (key) => turn.can[key] === can[key]
    )
    return same ? turn : { ...turn, can }
  })
  return turns.every((turn, i) => turn === state.turns[i])
    ? state
    : { ...state, turns }
}

/** What a Person may do with a turn before its `can` is worked out. */
export const NOTHING: Can = {
  stop: false,
  retry: false,
  edit: false,
  withdraw: false,
  steer: false,
  fork: false,
  rewind: false,
}

function project(state: ThreadState, event: Event): ThreadState {
  if (event.seq <= state.at) return state
  const next = { ...state, at: event.seq }
  const fact = decodeFact(event)
  if (!fact) return next
  const item = (id: string, body: Item["body"], turn?: string): Item => ({
    id,
    turn,
    author: event.author,
    at: event.at,
    body,
  })
  switch (fact.kind) {
    case "message.posted":
      return {
        ...next,
        items: [
          ...state.items,
          item(fact.payload.item, {
            kind: "message",
            text: fact.payload.text,
            images: fact.payload.images,
            ...(fact.payload.answers && { answers: true }),
          }),
        ],
        turns: [
          ...state.turns,
          {
            id: fact.payload.turn,
            message: fact.payload.item,
            state: "queued",
            // A turn runs with the settings its Thread has when asked.
            ...(state.settings.plan && { plan: true }),
            can: NOTHING,
          },
        ],
      }
    case "message.steered": {
      const { item: id, turn, text, images } = fact.payload
      // A waiting message sent now keeps who wrote it and when.
      const was = state.items.find((i) => i.id === id)
      const body: Body = { kind: "message", text, images }
      const steered = was ? { ...was, turn, body } : item(id, body, turn)
      return { ...next, items: moveLast(state.items, steered) }
    }
    case "message.edited": {
      const { item: id, text } = fact.payload
      return {
        ...next,
        items: changeItem(state, id, (i) =>
          i.body.kind === "message" ? { ...i, body: { ...i.body, text } } : i
        ),
      }
    }
    case "turn.started": {
      const started = state.turns.find((t) => t.id === fact.payload.turn)
      // A message reads where its turn starts, unless an earlier turn ran it.
      const first =
        started && firstTurnOf(state.turns, started.message)?.id === started.id
      const message = first && state.items.find((i) => i.id === started.message)
      return {
        ...next,
        items: message ? moveLast(state.items, message) : state.items,
        turns: changeTurn(state, fact.payload.turn, {
          state: "running",
          started: event.at,
        }),
      }
    }
    case "turn.ended":
      return {
        ...next,
        turns: changeTurn(state, fact.payload.turn, {
          state: fact.payload.state,
          reason: fact.payload.reason,
          failure: fact.payload.failure,
          ended: event.at,
        }),
      }
    case "turn.queued": {
      const { turn, message } = fact.payload
      return {
        ...next,
        // A message its turn could not take belongs to no turn but its own.
        items: changeItem(state, message, (i) => ({ ...i, turn: undefined })),
        turns: [
          ...state.turns,
          {
            id: turn,
            message,
            state: "queued",
            ...(state.settings.plan && { plan: true }),
            can: NOTHING,
          },
        ],
      }
    }
    case "thread.held":
      return { ...next, held: fact.payload.held }
    // A Thread's snooze is the list's for now (ADR 0074).
    case "thread.snoozed":
    case "thread.woke":
      return next
    case "thread.rewound": {
      // The turn and every one after it leave, with their messages and
      // what the Agent wrote in them.
      const from = state.turns.findIndex((t) => t.id === fact.payload.turn)
      if (from < 0) return next
      const gone = state.turns.slice(from)
      const turns = new Set(gone.map((turn) => turn.id))
      const messages = new Set(gone.map((turn) => turn.message))
      return {
        ...next,
        turns: state.turns.slice(0, from),
        items: state.items.filter(
          (item) =>
            !messages.has(item.id) &&
            (item.turn === undefined || !turns.has(item.turn))
        ),
      }
    }
    case "reply.grew":
    case "thought.grew": {
      const { item: id, turn, text } = fact.payload
      const body: Body =
        fact.kind === "reply.grew"
          ? { kind: "message", text, images: [] }
          : { kind: "thought", text }
      if (!state.items.some((i) => i.id === id)) {
        return { ...next, items: [...state.items, item(id, body, turn)] }
      }
      return {
        ...next,
        items: changeItem(state, id, (i) =>
          (i.body.kind === "message" || i.body.kind === "thought") &&
          i.body.kind === body.kind
            ? { ...i, body: { ...i.body, text: i.body.text + text } }
            : i
        ),
      }
    }
    case "tool.started": {
      const { item: id, turn, title, tool, status, content } = fact.payload
      const body: Body = { kind: "tool", title, tool, status, content }
      return { ...next, items: [...state.items, item(id, body, turn)] }
    }
    case "tool.changed": {
      const { item: id, title, status, content, exit } = fact.payload
      return {
        ...next,
        items: changeTool(state, id, (tool) => ({
          ...tool,
          title: title ?? tool.title,
          status: status ?? tool.status,
          content: content ?? tool.content,
          output:
            exit === undefined
              ? tool.output
              : { text: "", cut: false, ...tool.output, exit },
        })),
      }
    }
    case "tool.output": {
      const { item: id, text, cut } = fact.payload
      return {
        ...next,
        items: changeTool(state, id, (tool) => ({
          ...tool,
          output: {
            ...tool.output,
            text: (tool.output?.text ?? "") + text,
            cut: cut || (tool.output?.cut ?? false),
          },
        })),
      }
    }
    case "question.asked": {
      const { item: id, turn, title, choices, form, plan } = fact.payload
      const body: Body = {
        kind: "question",
        title,
        choices,
        form,
        plan,
        state: "open",
      }
      return { ...next, items: [...state.items, item(id, body, turn)] }
    }
    case "question.answered":
    case "question.closed": {
      const answered = fact.kind === "question.answered"
      const { choice, values } = answered ? fact.payload : {}
      return {
        ...next,
        items: changeItem(state, fact.payload.item, (i) =>
          i.body.kind === "question"
            ? {
                ...i,
                body: {
                  ...i.body,
                  state: answered ? "answered" : "closed",
                  answer: choice ?? i.body.answer,
                  values: values ?? i.body.values,
                },
              }
            : i
        ),
      }
    }
    case "plan.made": {
      const { item: id, turn, steps } = fact.payload
      return {
        ...next,
        items: [...state.items, item(id, { kind: "plan", steps }, turn)],
      }
    }
    case "plan.changed": {
      const { item: id, steps } = fact.payload
      return {
        ...next,
        items: changeItem(state, id, (item) =>
          item.body.kind === "plan"
            ? { ...item, body: { kind: "plan", steps } }
            : item
        ),
      }
    }
    case "thread.used":
      return { ...next, usage: fact.payload.usage }
    case "notice.posted": {
      const { item: id, turn, text } = fact.payload
      return {
        ...next,
        items: [...state.items, item(id, { kind: "notice", text }, turn)],
      }
    }
    case "issue.drafted": {
      const { item: id, turn, ...draft } = fact.payload
      const body = { kind: "issue", ...draft, state: "drafted" } as const
      return { ...next, items: [...state.items, item(id, body, turn)] }
    }
    case "issue.answered": {
      const { item: id, state: answered, title, body, url } = fact.payload
      return {
        ...next,
        items: changeItem(state, id, (one) =>
          one.body.kind === "issue"
            ? {
                ...one,
                body: {
                  ...one.body,
                  state: answered,
                  title: title ?? one.body.title,
                  body: body ?? one.body.body,
                  url,
                },
              }
            : one
        ),
      }
    }
    case "visual.shown": {
      const { item: id, turn, visual, title, height, heights } = fact.payload
      const body = { kind: "visual", visual, title, height, heights } as const
      return { ...next, items: [...state.items, item(id, body, turn)] }
    }
    case "thread.configured":
      return { ...next, settings: fact.payload.settings }
    case "thread.offered":
      return { ...next, offer: fact.payload.offer }
    case "thread.started":
      return {
        ...next,
        title: fact.payload.title,
        harness: fact.payload.harness ?? next.harness,
      }
    case "thread.renamed":
      return { ...next, title: fact.payload.title }
  }
}

/** The Question the Agent waits on, if any: the first still open. */
export function asked(state: ThreadState): Asked | undefined {
  return state.items.find(
    (item): item is Asked =>
      item.body.kind === "question" && item.body.state === "open"
  )
}

/** The answer that says no just this once, if the Question offers one. As
 * the engine does, it never picks one the Harness keeps for next time. */
export function declineOnce(question: QuestionBody): string | undefined {
  return question.choices.find((choice) => !choice.allows && !choice.always)?.id
}

/** An item that is a message. */
export type Said = Item & { body: Extract<Body, { kind: "message" }> }

/** The Project's other Threads by their Agents' IDs, and this Thread's own
 * Agent once the Thread list has said it. */
export type Listing = {
  threads: ReadonlyMap<string, ListedThread>
  self?: string
}

/**
 * The other Thread whose Agent wrote the message `item`: that Thread, or
 * `"gone"` when the list no longer has it; nothing for a message of this
 * Thread's own Agent or a Person, or before the list has come.
 */
export function writerOf(
  { threads, self }: Listing,
  item: Item
): ListedThread | "gone" | undefined {
  const { author, body } = item
  if (body.kind !== "message" || author.kind !== "agent") return undefined
  const thread = threads.get(author.id)
  if (thread) return thread
  return self !== undefined && author.id !== self ? "gone" : undefined
}

/** The Thread `id` of the Project: that Thread, or `"gone"` when the list no
 * longer has it; nothing before the list has come. */
export function threadOf(
  { threads, self }: Listing,
  id: string
): ListedThread | "gone" | undefined {
  for (const thread of threads.values()) if (thread.id === id) return thread
  return self !== undefined ? "gone" : undefined
}

/** Whether `item` is something the Agent wrote, not a Person. */
export function isReply(item: Item): item is Said {
  return item.body.kind === "message" && item.author.kind !== "person"
}

/** Where a turn in plan mode proposed its plan (ADR 0010, decision 6):
 * the Question that asks to carry it out, as Claude Code leaves plan mode,
 * or else the reply the turn ended done with. `items` may hold others'. */
export function planOf(turn: TurnView, items: Item[]): Item | undefined {
  if (!turn.plan) return undefined
  const own = items.filter((item) => item.turn === turn.id)
  const asked = own.find(
    (item) => item.body.kind === "question" && item.body.plan !== undefined
  )
  if (asked || turn.state !== "done") return asked
  return own.findLast(isReply)
}

/** The plan the Agent proposed in a reply, if it waits for the Person:
 * plan mode is still on, nothing runs or waits, and it is the latest
 * turn's plan. */
export function proposedPlan(state: ThreadState): Said | undefined {
  if (!state.settings.plan || working(state)) return undefined
  const settled = settledTurn(state.turns)
  const turn = state.turns.find((t) => t.id === settled)
  const plan = turn && planOf(turn, state.items)
  return plan && isReply(plan) ? plan : undefined
}

/** The turn the Agent works on, if any: the latest, as the engine says. */
export function running(state: ThreadState): TurnView | undefined {
  return state.turns.findLast((turn) => turn.state === "running")
}

/** Whether a message sent now goes into the turn that runs, as the
 * engine says (`Can.steer`). */
export function steerable(state: ThreadState): boolean {
  return running(state)?.can.steer ?? false
}

/** The turn the Agent works on, or the next one it will, unless a Person
 * holds the queue. */
export function working(state: ThreadState): TurnView | undefined {
  return (
    running(state) ??
    (state.held ? undefined : state.turns.find((t) => t.state === "queued"))
  )
}

/** A message that waits for its turn: shown after the Thread, where a
 * Person can change it, take it back or send it now. */
export type Waiting = { item: Item; turn: TurnView }

/** The messages that wait, in the order they will go: those a Person can
 * still change (`Can.edit`). A message tried again stays where it was,
 * since an earlier turn ran it. */
export function waiting(state: ThreadState): Waiting[] {
  const items = new Map(state.items.map((item) => [item.id, item]))
  return state.turns.flatMap((turn): Waiting[] => {
    const item = items.get(turn.message)
    return turn.can.edit && item ? [{ item, turn }] : []
  })
}

/** What the Person sent the Thread, oldest first, for ↑ and ↓ in the
 * composer: each text once in a row, none empty. */
export function sent(state: ThreadState): string[] {
  const texts: string[] = []
  for (const { author, body } of state.items) {
    const said = author.kind === "person" && body.kind === "message"
    if (said && body.text && texts.at(-1) !== body.text) texts.push(body.text)
  }
  return texts
}

/** Messages the Thread shows nowhere: taken back before any turn ran
 * them, and not sent into another. */
function withdrawn(state: ThreadState): Set<string> {
  const ran = new Set(
    state.turns
      .filter((turn) => turn.state !== "withdrawn")
      .map((turn) => turn.message)
  )
  return new Set(
    state.turns
      .filter((turn) => turn.state === "withdrawn" && !ran.has(turn.message))
      .map((turn) => turn.message)
  )
}

/** One line of a Thread as a Pane shows it. */
export type Row =
  | { kind: "item"; item: Item }
  /** A turn that did not finish, after the last thing it wrote. */
  | { kind: "ended"; turn: TurnView }

const UNFINISHED: ReadonlySet<TurnView["state"]> = new Set([
  "failed",
  "stopped",
  "interrupted",
])

/** The Thread's items, each unfinished turn's outcome after its last one:
 * what it wrote, or else the message that asked for it. The messages that
 * wait are not among them ({@link waiting}), nor those taken back. */
export function rows(state: ThreadState): Row[] {
  const gone = withdrawn(state)
  const waits = new Set(waiting(state).map(({ item }) => item.id))
  const items = state.items.filter(
    (item) => !waits.has(item.id) && !(gone.has(item.id) && !item.turn)
  )
  return flow({ ...state, items })
}

function flow(state: ThreadState): Row[] {
  const index = new Map(state.items.map((item, at) => [item.id, at]))
  const last = new Map<string, number>()
  for (const turn of state.turns) {
    const at = index.get(turn.message)
    if (at !== undefined) last.set(turn.id, at)
  }
  state.items.forEach((item, at) => {
    if (item.turn) last.set(item.turn, at)
  })
  const after = new Map<number, TurnView[]>()
  for (const turn of state.turns) {
    const at = last.get(turn.id)
    if (at === undefined || !UNFINISHED.has(turn.state)) continue
    after.set(at, [...(after.get(at) ?? []), turn])
  }
  return state.items.flatMap((item, index): Row[] => [
    { kind: "item", item },
    ...(after.get(index) ?? []).map((turn) => ({
      kind: "ended" as const,
      turn,
    })),
  ])
}
