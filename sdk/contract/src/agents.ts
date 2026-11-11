/**
 * The agents module's published language for TypeScript: its views, its
 * facts and the decoder a Pane reads events with.
 */
import type { Event } from "./generated/Event"
import type { Agents } from "./generated/agents/Agents"
import type { Body } from "./generated/agents/Body"
import type { Fact } from "./generated/agents/Fact"
import type { Item } from "./generated/agents/Item"
import type { ModuleFile } from "./look"
import { VERSION } from "./generated/agents/VERSION"

export type { AccountUse } from "./generated/agents/AccountUse"
export type { AgentCounts } from "./generated/agents/AgentCounts"
export type { Agents } from "./generated/agents/Agents"
export type { Archived } from "./generated/agents/Archived"
export type { Enter } from "./generated/agents/Enter"
export type { Flow } from "./generated/agents/Flow"
export type { Body } from "./generated/agents/Body"
export type { ChangedLines } from "./generated/agents/ChangedLines"
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
export type { CountedAs } from "./generated/agents/CountedAs"
export type { CountedThread } from "./generated/agents/CountedThread"
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
export type { Found } from "./generated/agents/Found"
export type { Hit } from "./generated/agents/Hit"
export type { SearchAsk } from "./generated/agents/SearchAsk"
export type { Sent } from "./generated/agents/Sent"
export type { Settings } from "./generated/agents/Settings"
export type { Skill } from "./generated/agents/Skill"
export type { SlashCommand } from "./generated/agents/SlashCommand"
export type { Later } from "./generated/agents/Later"
export type { LaterAsk } from "./generated/agents/LaterAsk"
export type { Wake } from "./generated/agents/Wake"
export type { Woke } from "./generated/agents/Woke"
export type { WokeSeen } from "./generated/agents/WokeSeen"
export type { SeeWokeAsk } from "./generated/agents/SeeWokeAsk"
export type { StepState } from "./generated/agents/StepState"
export type { OneSubagent } from "./generated/agents/OneSubagent"
export type { Subagent } from "./generated/agents/Subagent"
export type { SubagentId } from "./generated/agents/SubagentId"
export type { SubagentState } from "./generated/agents/SubagentState"
export type { SubagentView } from "./generated/agents/SubagentView"
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
export type { Doing } from "./generated/agents/Doing"
export type { DoingKind } from "./generated/agents/DoingKind"
export type { DoingNow } from "./generated/agents/DoingNow"
export type { ThreadDoing } from "./generated/agents/ThreadDoing"
export type { ThreadsDoing } from "./generated/agents/ThreadsDoing"
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
    "thread.later": true,
    "thread.woke": true,
    "thread.woke_seen": true,
    "thread.seen": true,
    "thread.unseen": true,
    "thread.archived": true,
    "thread.unarchived": true,
    "marks.moved": true,
    "thread.rewound": true,
    "thread.deleted": true,
    "thread.renamed": true,
    "thread.switched": true,
    "thread.left": true,
    "thread.arrived": true,
    "thread.moved": true,
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
    "subagent.started": true,
    "subagent.changed": true,
    "subagent.ended": true,
    "subagent.messaged": true,
    "visual.shown": true,
    "issue.drafted": true,
    "issue.answered": true,
  } satisfies Record<Fact["kind"], true>)
)

/** Every kind of Thread entry; the compiler checks it against the generated
 * union, so a kind added in Rust is listed here before it type-checks. */
export const BODY_KINDS: ReadonlySet<Body["kind"]> = new Set(
  Object.keys({
    message: true,
    thought: true,
    tool: true,
    plan: true,
    question: true,
    notice: true,
    moved: true,
    issue: true,
    visual: true,
    subagent: true,
    messaged: true,
  } satisfies Record<Body["kind"], true>) as Body["kind"][]
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

/**
 * Whether this window knows the kind of entry `item` is. A newer engine's
 * view may hold one it does not, which its Thread leaves out (ADR 0103,
 * decision 10): no fact brings one, as `decodeFact` drops a kind it does
 * not know.
 */
export function knownItem(item: Item): boolean {
  return BODY_KINDS.has(item.body.kind)
}

/** How messages are sent with no `agents.toml`, as `banda look` gives it:
 * for before the first look. */
export const DEFAULT_AGENTS: Agents = {
  enter: "steer",
  flow: "row",
  seen_after: 2.5,
}

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
