/**
 * The agents module's published language for TypeScript: its views, its
 * facts and the decoder a Pane reads events with.
 */
import type { Event } from "./generated/Event"
import type { Fact } from "./generated/agents/Fact"
import { VERSION } from "./generated/agents/VERSION"

export type { AgentView } from "./generated/agents/AgentView"
export type { Body } from "./generated/agents/Body"
export type { Choice } from "./generated/agents/Choice"
export type { Defaults } from "./generated/agents/Defaults"
export type { Failure } from "./generated/agents/Failure"
export type { Fact } from "./generated/agents/Fact"
export type { Field } from "./generated/agents/Field"
export type { FieldValue } from "./generated/agents/FieldValue"
export type { HarnessOption } from "./generated/agents/HarnessOption"
export type { HarnessView } from "./generated/agents/HarnessView"
export type { Input } from "./generated/agents/Input"
export type { Item } from "./generated/agents/Item"
export type { ItemId } from "./generated/agents/ItemId"
export type { Mode } from "./generated/agents/Mode"
export type { Offer } from "./generated/agents/Offer"
export type { OptionChoice } from "./generated/agents/OptionChoice"
export type { OptionValue } from "./generated/agents/OptionValue"
export type { Exit } from "./generated/agents/Exit"
export type { Output } from "./generated/agents/Output"
export type { QuestionState } from "./generated/agents/QuestionState"
export type { Sent } from "./generated/agents/Sent"
export type { Settings } from "./generated/agents/Settings"
export type { ThreadId } from "./generated/agents/ThreadId"
export type { ThreadList } from "./generated/agents/ThreadList"
export type { ThreadSummary } from "./generated/agents/ThreadSummary"
export type { ThreadView } from "./generated/agents/ThreadView"
export type { ToolContent } from "./generated/agents/ToolContent"
export type { ToolKind } from "./generated/agents/ToolKind"
export type { ToolStatus } from "./generated/agents/ToolStatus"
export type { TurnId } from "./generated/agents/TurnId"
export type { TurnState } from "./generated/agents/TurnState"
export type { TurnView } from "./generated/agents/TurnView"

export { VERSION }

/** Every kind of fact; the compiler checks it against the generated union. */
const KINDS: ReadonlySet<string> = new Set(
  Object.keys({
    "agent.created": true,
    "thread.started": true,
    "message.posted": true,
    "turn.started": true,
    "turn.ended": true,
    "turn.queued": true,
    "thread.configured": true,
    "thread.offered": true,
    "reply.grew": true,
    "thought.grew": true,
    "tool.started": true,
    "tool.changed": true,
    "tool.output": true,
    "question.asked": true,
    "question.answered": true,
    "question.closed": true,
    "notice.posted": true,
  } satisfies Record<Fact["kind"], true>)
)

/**
 * The fact an event carries, or `null` when this window does not know it:
 * another module's event, a newer version, or a kind added since. Unknown
 * fields in a known payload are ignored, so an engine may be newer.
 */
export function decodeFact(event: Event): Fact | null {
  const known =
    event.module === "agents" &&
    event.version <= VERSION &&
    KINDS.has(event.kind) &&
    typeof event.payload === "object" &&
    event.payload !== null
  return known ? ({ kind: event.kind, payload: event.payload } as Fact) : null
}
