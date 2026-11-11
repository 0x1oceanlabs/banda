/**
 * One entry, and one sub-agent's record, as a fact starts or changes it:
 * what a Thread's fold (`state.ts`), a sub-agent's (`live-lane.ts`) and
 * what the Pane heard of each sub-agent (`live-thread.ts`) share, so all
 * three change an entry alike. Pure, so plain tests cover it.
 */
import type { Event } from "@banda/contract"
import type {
  Body,
  Fact,
  Item,
  Subagent,
  SubagentState,
} from "@banda/contract/agents"

type Payload<K extends Fact["kind"]> = Extract<Fact, { kind: K }>["payload"]

/** An entry `event` wrote: its author's, at its time. */
export function entryOf(
  event: Event,
  id: string,
  body: Body,
  turn?: string
): Item {
  return { id, turn, author: event.author, at: event.at, body }
}

/** A call as it starts. */
export function called(payload: Payload<"tool.started">): Body {
  const { title, tool, status, content } = payload
  return { kind: "tool", title, tool, status, content }
}

/** The sub-agent whose lane a fact is of, when it is not the Agent's
 * own; for a Question, the sub-agent that asks. */
export function subOf(fact: Fact): string | undefined {
  return (fact.payload as { sub?: string }).sub
}

/** Whether `item` is a Question a sub-agent asks: the Thread's all the
 * same, though its row says it, not the Thread (ADR 0103, decision 28). */
export function askedByLane({ body }: Item): boolean {
  return body.kind === "question" && body.sub !== undefined
}

/**
 * The entry `fact` starts as it comes, if it starts one: a reply or a
 * thought that grows from nothing, a call, a plan, a notice, a Question.
 * A reply or thought that grows one already there changes it instead
 * ({@link changedBy}).
 */
export function startedBy(fact: Fact, event: Event): Item | undefined {
  const at = (id: string, body: Body, turn?: string) =>
    entryOf(event, id, body, turn)
  switch (fact.kind) {
    case "reply.grew":
    case "thought.grew": {
      const { item, turn, text } = fact.payload
      const body: Body =
        fact.kind === "reply.grew"
          ? { kind: "message", text, images: [] }
          : { kind: "thought", text }
      return at(item, body, turn)
    }
    case "tool.started":
      return at(fact.payload.item, called(fact.payload), fact.payload.turn)
    case "plan.made": {
      const { item, turn, steps } = fact.payload
      return at(item, { kind: "plan", steps }, turn)
    }
    case "notice.posted": {
      const { item, turn, text } = fact.payload
      return at(item, { kind: "notice", text }, turn)
    }
    case "question.asked": {
      const { item, turn, title, choices, form, plan, sub } = fact.payload
      const body: Body = {
        kind: "question",
        title,
        choices,
        form,
        plan,
        state: "open",
        // The sub-agent that asks; its Question is the Thread's all the same.
        ...(sub && { sub }),
      }
      return at(item, body, turn)
    }
    case "subagent.messaged": {
      const { item, turn, subagent, text } = fact.payload
      return at(item, messagedBody(subagent, text), turn)
    }
    default:
      return undefined
  }
}

/** What the Agent, or a sub-agent, wrote to sub-agent `subagent` after
 * its brief; no words when the Harness gave none (ADR 0103, decision 25). */
function messagedBody(subagent: string, text: string | undefined): Body {
  return { kind: "messaged", subagent, ...(text !== undefined && { text }) }
}

/** The entry `fact` changes, by its ID, if it names one. */
export function namedBy(fact: Fact): string | undefined {
  switch (fact.kind) {
    case "reply.grew":
    case "thought.grew":
    case "tool.changed":
    case "tool.output":
    case "plan.changed":
    case "question.answered":
    case "question.closed":
    case "subagent.messaged":
      return fact.payload.item
    default:
      return undefined
  }
}

/** `item` as `fact` changes it; `item` itself when the fact does not
 * change an entry of its kind. */
export function changedBy(item: Item, fact: Fact): Item {
  const body = changedBody(item.body, fact)
  return body === item.body ? item : { ...item, body }
}

function changedBody(body: Body, fact: Fact): Body {
  switch (fact.kind) {
    case "reply.grew":
    case "thought.grew": {
      const kind = fact.kind === "reply.grew" ? "message" : "thought"
      return body.kind === kind
        ? { ...body, text: body.text + fact.payload.text }
        : body
    }
    case "tool.changed": {
      if (body.kind !== "tool") return body
      const { title, status, content, exit } = fact.payload
      return {
        ...body,
        title: title ?? body.title,
        status: status ?? body.status,
        content: content ?? body.content,
        output:
          exit === undefined
            ? body.output
            : { text: "", cut: false, ...body.output, exit },
      }
    }
    case "tool.output": {
      if (body.kind !== "tool") return body
      const { text, cut } = fact.payload
      return {
        ...body,
        output: {
          ...body.output,
          text: (body.output?.text ?? "") + text,
          cut: cut || (body.output?.cut ?? false),
        },
      }
    }
    case "plan.changed":
      return body.kind === "plan"
        ? { kind: "plan", steps: fact.payload.steps }
        : body
    case "question.answered":
    case "question.closed": {
      if (body.kind !== "question") return body
      const answered = fact.kind === "question.answered"
      const { choice, values } = answered ? fact.payload : {}
      return {
        ...body,
        state: answered ? "answered" : "closed",
        answer: choice ?? body.answer,
        values: values ?? body.values,
      }
    }
    // Given again, it holds all its words so far.
    case "subagent.messaged":
      return body.kind === "messaged" && body.text !== fact.payload.text
        ? messagedBody(body.subagent, fact.payload.text)
        : body
    default:
      return body
  }
}

/** `list` with its one of `id` changed by `change`. */
export function changeOne<T extends { id: string }>(
  list: T[],
  id: string,
  change: (one: T) => T
): T[] {
  return list.map((one) => (one.id === id ? change(one) : one))
}

/** `items` with the entry `fact` names changed by it; `items` itself when
 * it names none of them. */
export function changedIn(items: Item[], fact: Fact): Item[] {
  const id = namedBy(fact)
  return id !== undefined && items.some((item) => item.id === id)
    ? changeOne(items, id, (item) => changedBy(item, fact))
    : items
}

/** `items` after `fact`: the entry it changes changed, or the one it
 * starts after the others. The same list when it does neither. */
export function grown(items: Item[], fact: Fact, event: Event): Item[] {
  const changed = changedIn(items, fact)
  if (changed !== items) return changed
  const started = startedBy(fact, event)
  return started ? [...items, started] : items
}

/** Whether a sub-agent works: it runs, or asks. */
export function atWork(lane: Subagent): boolean {
  return lane.state === "running" || lane.state === "asks"
}

/** Whether a sub-agent in `state` has ended, as it can end: done,
 * failed, stopped or lost. */
export function ends(state: SubagentState): boolean {
  return (
    state === "done" ||
    state === "failed" ||
    state === "stopped" ||
    state === "lost"
  )
}

/** Sub-agent `lane` as `subagent.changed` changes it, `change` its
 * payload but the sub-agent it names: what the Harness said, and its role
 * cleared when it cleared it. At work again, it has not ended. */
export function laneChanged(
  lane: Subagent,
  change: Omit<Payload<"subagent.changed">, "subagent">
): Subagent {
  const { role, ...given } = change
  const changed: Subagent = { ...lane, ...given }
  if (role === null) delete changed.role
  else if (role !== undefined) changed.role = role
  if (given.state !== undefined && atWork(changed)) {
    delete changed.ended
    delete changed.why
  }
  return changed
}

/** Sub-agent `lane` as `subagent.ended` ends it: it can no longer be
 * stopped, and the why is this end's. */
export function laneEnded(
  lane: Subagent,
  payload: Payload<"subagent.ended">
): Subagent {
  const { state, why, report, ended } = payload
  const changed: Subagent = {
    ...lane,
    state,
    ended,
    can_stop: false,
    why,
    report: report ?? lane.report,
  }
  if (why === undefined) delete changed.why
  if (changed.report === undefined) delete changed.report
  return changed
}
