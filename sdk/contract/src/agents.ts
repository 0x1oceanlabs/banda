/**
 * The agents module's published language for TypeScript: its views, its
 * facts and the decoder a Pane reads events with.
 */
import type { Event } from "./generated/Event"
import type { Agents } from "./generated/agents/Agents"
import type { Fact } from "./generated/agents/Fact"
import type { ModuleFile } from "./look"
import { VERSION } from "./generated/agents/VERSION"

export type { Agents } from "./generated/agents/Agents"
export type { Archived } from "./generated/agents/Archived"
export type { Enter } from "./generated/agents/Enter"
export type { Flow } from "./generated/agents/Flow"
export type { Body } from "./generated/agents/Body"
export type { ChangesAsk } from "./generated/agents/ChangesAsk"
export type { ChangedTurn } from "./generated/agents/ChangedTurn"
export type { TurnChanges } from "./generated/agents/TurnChanges"
export type { TurnFile } from "./generated/agents/TurnFile"
export type { Can } from "./generated/agents/Can"
export type { Choice } from "./generated/agents/Choice"
export type { Cost } from "./generated/agents/Cost"
export type { Defaults } from "./generated/agents/Defaults"
export type { Exit } from "./generated/agents/Exit"
export type { Fact } from "./generated/agents/Fact"
export type { Failure } from "./generated/agents/Failure"
export type { Field } from "./generated/agents/Field"
export type { FieldValue } from "./generated/agents/FieldValue"
export type { Forked } from "./generated/agents/Forked"
export type { HarnessOption } from "./generated/agents/HarnessOption"
export type { Image } from "./generated/agents/Image"
export type { ImageData } from "./generated/agents/ImageData"
export type { ImageId } from "./generated/agents/ImageId"
export type { ImportMarks } from "./generated/agents/ImportMarks"
export type { Imported } from "./generated/agents/Imported"
export type { Input } from "./generated/agents/Input"
export type { Item } from "./generated/agents/Item"
export type { ItemId } from "./generated/agents/ItemId"
export type { Asking } from "./generated/agents/Asking"
export type { LatestTurn } from "./generated/agents/LatestTurn"
export type { ListedThread } from "./generated/agents/ListedThread"
export type { Mode } from "./generated/agents/Mode"
export type { Offer } from "./generated/agents/Offer"
export type { OptionChoice } from "./generated/agents/OptionChoice"
export type { OptionValue } from "./generated/agents/OptionValue"
export type { Output } from "./generated/agents/Output"
export type { PlanStep } from "./generated/agents/PlanStep"
export type { QuestionState } from "./generated/agents/QuestionState"
export type { ReadAsk } from "./generated/agents/ReadAsk"
export type { Sent } from "./generated/agents/Sent"
export type { Settings } from "./generated/agents/Settings"
export type { Skill } from "./generated/agents/Skill"
export type { SlashCommand } from "./generated/agents/SlashCommand"
export type { Snooze } from "./generated/agents/Snooze"
export type { SnoozeAsk } from "./generated/agents/SnoozeAsk"
export type { Wake } from "./generated/agents/Wake"
export type { Woke } from "./generated/agents/Woke"
export type { WokeSeen } from "./generated/agents/WokeSeen"
export type { SeeWokeAsk } from "./generated/agents/SeeWokeAsk"
export type { StepState } from "./generated/agents/StepState"
export type { ThreadId } from "./generated/agents/ThreadId"
export type { ThreadList } from "./generated/agents/ThreadList"
export type { ThreadSummary } from "./generated/agents/ThreadSummary"
export type { ThreadView } from "./generated/agents/ThreadView"
export type { ToolContent } from "./generated/agents/ToolContent"
export type { ToolKind } from "./generated/agents/ToolKind"
export type { ToolStatus } from "./generated/agents/ToolStatus"
export type { Touched } from "./generated/agents/Touched"
export type { Touching } from "./generated/agents/Touching"
export type { TouchKind } from "./generated/agents/TouchKind"
export type { TurnId } from "./generated/agents/TurnId"
export type { Appearance } from "./generated/agents/Appearance"
export type { Fit } from "./generated/agents/Fit"
export type { Fitting } from "./generated/agents/Fitting"
export type { LayOut } from "./generated/agents/LayOut"
export type { Logged } from "./generated/agents/Logged"
export type { Previewed } from "./generated/agents/Previewed"
export type { VisualId } from "./generated/agents/VisualId"
export type { VisualPage } from "./generated/agents/VisualPage"
export type { TurnState } from "./generated/agents/TurnState"
export type { TurnView } from "./generated/agents/TurnView"
export type { Usage } from "./generated/agents/Usage"
export type { WhySupervised } from "./generated/agents/WhySupervised"
export type { WriteAsk } from "./generated/agents/WriteAsk"
export type { Written } from "./generated/agents/Written"

export { VERSION }

/** Every kind of fact; the compiler checks it against the generated union. */
const KINDS: ReadonlySet<string> = new Set(
  Object.keys({
    "thread.started": true,
    "message.posted": true,
    "turn.started": true,
    "turn.ended": true,
    "turn.queued": true,
    "message.steered": true,
    "message.edited": true,
    "thread.held": true,
    "thread.snoozed": true,
    "thread.woke": true,
    "thread.woke_seen": true,
    "thread.seen": true,
    "thread.unseen": true,
    "thread.archived": true,
    "thread.unarchived": true,
    "marks.moved": true,
    "thread.rewound": true,
    "thread.renamed": true,
    "thread.switched": true,
    "thread.configured": true,
    "thread.offered": true,
    "thread.used": true,
    "reply.grew": true,
    "thought.grew": true,
    "tool.started": true,
    "tool.changed": true,
    "tool.output": true,
    "plan.made": true,
    "plan.changed": true,
    "question.asked": true,
    "question.answered": true,
    "question.closed": true,
    "notice.posted": true,
    "visual.shown": true,
    "issue.drafted": true,
    "issue.answered": true,
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

/** How messages are sent with no `agents.toml`, as `banda look` gives it:
 * for before the first look. */
export const DEFAULT_AGENTS: Agents = { enter: "steer", flow: "row" }

/** The agents module's `agents.toml`. */
export const AGENTS_FILE: ModuleFile<Agents> = {
  name: "agents.toml",
  before: DEFAULT_AGENTS,
}

/** A file a path in a reply names, as the window's main process found it
 * (ADR 0063, decision 2). */
export type FoundFile = {
  /** Its full path. */
  file: string
  /** Its path from the Thread's folder if it is in it, else from the
   * folder it was found in; its full path when there is none. */
  relative: string
  /** Whether it is in the Thread's folder. */
  inside: boolean
}
