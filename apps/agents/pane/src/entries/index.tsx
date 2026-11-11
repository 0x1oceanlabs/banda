/**
 * The Thread's entries, one view for each kind of its body (ADR 0091,
 * decision 2). A new kind in the contract does not compile until it has a
 * row here; its rules for the timeline are in `kinds.ts`.
 */
import { memo } from "react"
import type { Body } from "@banda/contract/agents"
import { CallEntry } from "./call"
import { IssueEntry } from "./issue"
import { MessageEntry } from "./message"
import { MessagedEntry } from "./messaged"
import { MovedEntry } from "./moved"
import { NoticeEntry } from "./notice"
import { PlanEntry } from "./plan"
import { QuestionEntry } from "./question"
import { SubagentEntry } from "./subagent"
import { ThoughtEntry } from "./thought"
import type { EntryProps, EntryView } from "./types"
import { VisualEntry } from "./visual"

const VIEWS: { [K in Body["kind"]]: EntryView<K> } = {
  message: MessageEntry,
  thought: ThoughtEntry,
  tool: CallEntry,
  plan: PlanEntry,
  question: QuestionEntry,
  notice: NoticeEntry,
  moved: MovedEntry,
  issue: IssueEntry,
  visual: VisualEntry,
  subagent: SubagentEntry,
  messaged: MessagedEntry,
}

/** One entry, drawn by its kind; drawn again only when it or what its
 * Thread knows of it changes (ADR 0088, decision 9). */
export const Entry = memo(function Entry(props: EntryProps<Body["kind"]>) {
  const View = VIEWS[props.item.body.kind] as EntryView<Body["kind"]>
  return <View {...props} />
})
