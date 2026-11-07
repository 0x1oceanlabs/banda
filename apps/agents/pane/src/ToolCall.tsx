import { Fragment, useMemo } from "react"
import type {
  Exit,
  Output,
  ToolContent,
  ToolKind,
  TurnState,
} from "@banda/contract/agents"
import {
  Console,
  ConsoleFooter,
  ConsoleText,
} from "@banda/ui/components/console"
import { DiffCounts } from "@banda/ui/components/diff"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import {
  BrainIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  MoveRightIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { type Outcome, outcome, said } from "./calls"
import { type FileChange, fileChange, total } from "./changes"
import { FileDiff } from "./FileDiff"
import { ThreadImage, type ImageReader } from "./MessageImages"
import type { Tool } from "./thread"

/** A tool call's content as the window shows it: a diff with its lines. */
type Part =
  Exclude<ToolContent, { kind: "diff" }> | ({ kind: "diff" } & FileChange)

/**
 * A tool call in a Thread: its line, in the past tense once it ended, "Ran
 * pnpm test", with a tag when it failed, was stopped or waits for its
 * Person (ADR 0058, decision 4). Opened, what it changed in files, its
 * text and images, and what its command printed.
 */
export function ToolCall({
  tool,
  reader,
  onOpenDiff,
  turn,
  asks = false,
}: {
  tool: Tool
  reader: ImageReader
  /** Opens a file this call changed in a Diff Pane. */
  onOpenDiff?: (path: string) => void
  /** How its turn stands, if known. */
  turn?: TurnState
  /** A Question of its turn is open, and this call waits on it. */
  asks?: boolean
}) {
  const Icon = TOOL_ICONS[tool.tool]
  const now = outcome(tool, turn, asks)
  const { verb, subject } = said(tool, now)
  const shown = useMemo(
    () =>
      tool.content.map((part): Part => {
        if (part.kind !== "diff") return part
        return { kind: "diff", ...fileChange(part.path, part.old, part.new) }
      }),
    [tool.content]
  )
  const counted = total(shown.filter((part) => part.kind === "diff"))
  // What its command prints shows where its terminal is, or else last.
  const terminal = shown.findIndex((part) => part.kind === "terminal")
  const running = now === "running" || now === "waiting"
  const printed = (
    <Printed
      output={tool.output ?? { text: "", cut: false }}
      running={running}
    />
  )
  const line = (
    <TraceLine status={now === "running" ? "running" : undefined}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>
        {verb}
        {verb && subject && " "}
        {subject && (
          <span className={verb ? "text-foreground" : undefined}>
            {subject}
          </span>
        )}
      </TraceTitle>
      {counted.added + counted.removed > 0 && <DiffCounts {...counted} />}
      <Tag outcome={now} />
    </TraceLine>
  )
  if (shown.length === 0 && !tool.output) return <Trace>{line}</Trace>
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent inset className="flex flex-col gap-2">
          {shown.map((part, at) => {
            switch (part.kind) {
              case "image":
                return (
                  <ThreadImage key={at} image={part.image} reader={reader} />
                )
              case "diff":
                return (
                  <FileDiff
                    key={at}
                    {...part}
                    onOpen={onOpenDiff && (() => onOpenDiff(part.path))}
                  />
                )
              case "terminal":
                return (
                  at === terminal && <Fragment key={at}>{printed}</Fragment>
                )
              case "text":
                return (
                  <pre
                    key={at}
                    data-slot="tool-text"
                    className="max-h-80 overflow-auto rounded-md border bg-block px-3 py-2 font-mono text-code wrap-break-word whitespace-pre-wrap"
                  >
                    {part.text}
                  </pre>
                )
            }
          })}
          {terminal < 0 && tool.output && printed}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** What a command printed, and how it ended once it has. */
function Printed({
  output: { text, exit, cut },
  running,
}: {
  output: Output
  running: boolean
}) {
  // A signal stopped it: that is no failure of its own.
  const failed = exit?.code !== undefined && exit.code !== 0
  return (
    <Console>
      <ConsoleText
        className={text === "" ? "text-muted-foreground" : undefined}
      >
        {text !== ""
          ? text
          : running
            ? "Nothing printed yet."
            : "It printed nothing."}
      </ConsoleText>
      {(exit !== undefined || cut) && (
        <ConsoleFooter>
          {exit !== undefined && (
            <span className={failed ? "text-destructive" : undefined}>
              {ended(exit)}
            </span>
          )}
          {cut && <span>It printed more than the Thread keeps.</span>}
        </ConsoleFooter>
      )}
    </Console>
  )
}

/** How a command ended, in plain words. */
function ended({ code, signal }: Exit): string {
  if (code === 0) return "Finished."
  if (code !== undefined) return `Ended with code ${code}.`
  if (signal !== undefined) return `Stopped by ${signal}.`
  return "Ended."
}

const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  read: FileTextIcon,
  edit: FilePenIcon,
  delete: Trash2Icon,
  move: MoveRightIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  other: WrenchIcon,
}

/** A small word after a call's line: it failed, was stopped, or waits
 * for its Person. Failure is a tag, not a red line. */
function Tag({ outcome }: { outcome: Outcome }) {
  const [words, colour] =
    outcome === "failed"
      ? ["Failed", "text-destructive"]
      : outcome === "stopped"
        ? ["Stopped", "text-muted-foreground"]
        : outcome === "waiting"
          ? ["Waiting for you", "text-attention"]
          : []
  return words ? (
    <span className={`shrink-0 text-meta ${colour}`}>{words}</span>
  ) : null
}
