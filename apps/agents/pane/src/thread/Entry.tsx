/** One entry of a Thread, drawn by its kind (ADR 0091, decision 2). */
import type { Item, ListedThread, TurnView } from "@banda/contract/agents"
import { Markdown } from "@banda/ui/components/markdown"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { duration } from "@banda/ui/lib/words"
import { BrainIcon, InfoIcon } from "lucide-react"
import { AgentMessage, PersonMessage, Writer } from "../Messages"
import { Question } from "../Questions"
import { Plan } from "../Plan"
import { ToolCall } from "../ToolCall"
import { Issue } from "../Issue"
import { Visual } from "../Visual"
import { useThreadAround } from "./context"

export function Entry({
  item,
  turn,
  asks,
  took,
  live,
  writer,
  onFork,
  onEdit,
}: {
  item: Item
  /** How its turn stands, if it has one. */
  turn?: TurnView["state"]
  /** It is a call that waits for its Person's answer. */
  asks: boolean
  /** How long it took, in ms, when it is a thought and that is known. */
  took?: number
  /** From {@link AgentMessage}'s `onFork`. */
  onFork?: (() => void) | null
  /** From {@link PersonMessage}'s `onEdit`. */
  onEdit?: (() => void) | null
  /** Whether the Agent is still writing it. */
  live: boolean
  /** The other Thread whose Agent wrote it, if one did. */
  writer?: ListedThread | "gone"
}) {
  const { engine, project, reader, acts } = useThreadAround()
  const body = item.body
  switch (body.kind) {
    case "message":
      return item.author.kind === "person" ? (
        <PersonMessage
          onEdit={onEdit}
          text={body.text}
          images={body.images}
          at={item.at}
          reader={reader}
        />
      ) : (
        <AgentMessage
          text={body.text}
          at={item.at}
          live={live}
          onFork={onFork}
          from={
            writer && (
              <Writer
                thread={writer}
                answers={body.answers}
                onOpen={acts.openThread}
              />
            )
          }
        />
      )
    case "thought":
      return (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine status={live ? "running" : undefined}>
                <TraceIcon>
                  <BrainIcon />
                </TraceIcon>
                <TraceTitle>
                  {live
                    ? "Thinking"
                    : took !== undefined && took >= 1000
                      ? `Thought for ${duration(took)}`
                      : "Thought"}
                </TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent inset>
              <Markdown streaming={live} className="text-muted-foreground">
                {body.text}
              </Markdown>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )
    case "tool": {
      // A call that failed changed nothing the turn's changes show.
      const changed = body.status !== "failed" ? item.turn : undefined
      return (
        <ToolCall
          tool={body}
          reader={reader}
          turn={turn}
          asks={asks}
          onOpenDiff={
            changed === undefined
              ? undefined
              : (path) => acts.openDiff(changed, path)
          }
        />
      )
    }
    case "plan":
      return <Plan steps={body.steps} />
    case "question":
      return <Question question={body} />
    case "notice":
      return (
        <Trace>
          <TraceLine>
            <TraceIcon>
              <InfoIcon />
            </TraceIcon>
            <TraceTitle className="whitespace-normal">{body.text}</TraceTitle>
          </TraceLine>
        </Trace>
      )
    case "issue":
      return (
        <Issue engine={engine} project={project} item={item.id} issue={body} />
      )
    case "visual": {
      const { visual, title, height, heights } = body
      const args = { visual, title, height, heights }
      return (
        <Visual
          project={project}
          visual={args}
          onOpen={() => acts.openVisual(args)}
        />
      )
    }
  }
}
