/**
 * A Thread as a Pane holds it: the view it loaded, then each fact applied in
 * the log's order (ADR 0002, decision 5). Pure, so plain tests cover it.
 */
import type { Event } from "@bandaso/contract"
import {
  decodeFact,
  type Item,
  type ThreadView,
  type TurnView,
} from "@bandaso/contract/agents"

export type ThreadState = {
  /** The last position in the Space's log this state includes. */
  at: number
  items: Item[]
  turns: TurnView[]
}

export const EMPTY: ThreadState = { at: 0, items: [], turns: [] }

export function fromView(view: ThreadView): ThreadState {
  return { at: view.at, items: view.items, turns: view.turns }
}

function changeItem(
  state: ThreadState,
  id: string,
  change: (item: Item) => Item
): Item[] {
  return state.items.map((item) => (item.id === id ? change(item) : item))
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
          item(fact.payload.item, { kind: "message", text: fact.payload.text }),
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
    case "turn.started":
      return {
        ...next,
        turns: changeTurn(state, fact.payload.turn, { state: "running" }),
      }
    case "turn.ended":
      return {
        ...next,
        turns: changeTurn(state, fact.payload.turn, {
          state: fact.payload.state,
          reason: fact.payload.reason,
        }),
      }
    case "reply.grew":
    case "thought.grew": {
      const { item: id, turn, text } = fact.payload
      const kind = fact.kind === "reply.grew" ? "message" : "thought"
      if (!state.items.some((i) => i.id === id)) {
        return {
          ...next,
          items: [...state.items, item(id, { kind, text }, turn)],
        }
      }
      return {
        ...next,
        items: changeItem(state, id, (i) =>
          i.body.kind === kind
            ? { ...i, body: { kind, text: i.body.text + text } }
            : i
        ),
      }
    }
    case "tool.started": {
      const { item: id, turn, title, tool, status } = fact.payload
      return {
        ...next,
        items: [
          ...state.items,
          item(id, { kind: "tool", title, tool, status }, turn),
        ],
      }
    }
    case "tool.changed": {
      const { item: id, title, status } = fact.payload
      return {
        ...next,
        items: changeItem(state, id, (i) =>
          i.body.kind === "tool"
            ? {
                ...i,
                body: {
                  ...i.body,
                  title: title ?? i.body.title,
                  status: status ?? i.body.status,
                },
              }
            : i
        ),
      }
    }
    case "question.asked": {
      const { item: id, turn, title, choices } = fact.payload
      return {
        ...next,
        items: [
          ...state.items,
          item(id, { kind: "question", title, choices, state: "open" }, turn),
        ],
      }
    }
    case "question.answered":
    case "question.closed": {
      const answered = fact.kind === "question.answered"
      const choice = answered ? fact.payload.choice : undefined
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
                },
              }
            : i
        ),
      }
    }
    case "notice.posted": {
      const { item: id, turn, text } = fact.payload
      return {
        ...next,
        items: [...state.items, item(id, { kind: "notice", text }, turn)],
      }
    }
    case "agent.created":
    case "thread.started":
      return next
  }
}

/** The turn the Agent works on or will work on next, if any. */
export function working(state: ThreadState): TurnView | undefined {
  return state.turns.findLast(
    (turn) => turn.state === "queued" || turn.state === "running"
  )
}

/** One line of a Thread as a Pane shows it. */
export type Row =
  | { kind: "item"; item: Item }
  /** A turn that failed or was stopped, after the last thing it wrote. */
  | { kind: "ended"; turn: TurnView }

/** The Thread's items, each unfinished turn's outcome after its last one. */
export function rows(state: ThreadState): Row[] {
  const asked = new Map(state.turns.map((turn) => [turn.message, turn.id]))
  const last = new Map<string, number>()
  state.items.forEach((item, index) => {
    const turn = item.turn ?? asked.get(item.id)
    if (turn) last.set(turn, index)
  })
  const after = new Map<number, TurnView[]>()
  for (const turn of state.turns) {
    const index = last.get(turn.id)
    if (index === undefined) continue
    if (turn.state !== "failed" && turn.state !== "stopped") continue
    after.set(index, [...(after.get(index) ?? []), turn])
  }
  return state.items.flatMap((item, index): Row[] => [
    { kind: "item", item },
    ...(after.get(index) ?? []).map((turn) => ({
      kind: "ended" as const,
      turn,
    })),
  ])
}
