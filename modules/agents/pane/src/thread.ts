/**
 * A Thread as a Pane holds it: the view it loaded, then each fact applied in
 * the log's order (ADR 0002, decision 5). Pure, so plain tests cover it.
 */
import type { Event } from "@bandaso/contract"
import {
  decodeFact,
  type Body,
  type HarnessOption,
  type Item,
  type Offer,
  type OptionValue,
  type Settings,
  type ThreadView,
  type TurnView,
  type Usage,
} from "@bandaso/contract/agents"

export type ThreadState = {
  /** The last position in the Space's log this state includes. */
  at: number
  /** The start of its first message. */
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
  return { at, title, harness, items, turns, settings, offer, usage, held }
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
function firstTurnOf(turns: TurnView[], message: string): TurnView | undefined {
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
          }),
        ],
        turns: [
          ...state.turns,
          {
            id: fact.payload.turn,
            message: fact.payload.item,
            state: "queued",
          },
        ],
      }
    case "message.steered": {
      const { item: id, turn, text, images } = fact.payload
      const steered = item(id, { kind: "message", text, images }, turn)
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
        turns: [...state.turns, { id: turn, message, state: "queued" }],
      }
    }
    case "thread.held":
      return { ...next, held: fact.payload.held }
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
      const { item: id, turn, title, choices, form } = fact.payload
      const body: Body = {
        kind: "question",
        title,
        choices,
        form,
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
  }
}

/** The turn the Agent works on, if any: the latest, as the engine says. */
export function running(state: ThreadState): TurnView | undefined {
  return state.turns.findLast((turn) => turn.state === "running")
}

/** Whether the Agent started `turn` by itself: its message is a notice
 * from Bandaso, not a Person's. */
export function byItself(state: ThreadState, turn: TurnView): boolean {
  const message = state.items.find((item) => item.id === turn.message)
  return message?.body.kind === "notice"
}

/** Whether a message sent now goes into the turn that runs. One a Person
 * stopped takes nothing more, and one the Agent went on with by itself
 * takes a message as a turn of its own, which the Harness takes in. */
export function steerable(state: ThreadState): boolean {
  const turn = running(state)
  return turn !== undefined && !state.held && !byItself(state, turn)
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

/** The messages that wait, in the order they will go. A message tried
 * again stays where it was, since an earlier turn ran it. */
export function waiting(state: ThreadState): Waiting[] {
  const items = new Map(state.items.map((item) => [item.id, item]))
  return state.turns.flatMap((turn): Waiting[] => {
    const item = items.get(turn.message)
    if (turn.state !== "queued" || !item) return []
    return firstTurnOf(state.turns, turn.message) === turn
      ? [{ item, turn }]
      : []
  })
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

/** Whether a Person can try `turn`'s message again: it failed or was cut
 * short, no turn began after it, and its message waits for no other. */
export function retryable(state: ThreadState, turn: TurnView): boolean {
  const last = (turns: TurnView[]) => turns.at(-1)?.id === turn.id
  const counted = state.turns.filter((t) => t.state !== "withdrawn")
  const latest =
    last(counted.filter((t) => t.state !== "queued")) &&
    last(counted.filter((t) => t.message === turn.message))
  const failed = turn.state === "failed" || turn.state === "interrupted"
  return latest && failed && !byItself(state, turn)
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
