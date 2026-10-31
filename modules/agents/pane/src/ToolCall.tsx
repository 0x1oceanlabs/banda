import { Fragment, useMemo } from "react"
import type {
  Exit,
  Output,
  ToolContent,
  ToolKind,
  ToolStatus,
} from "@bandaso/contract/agents"
import {
  Console,
  ConsoleFooter,
  ConsoleText,
} from "@bandaso/ui/components/console"
import {
  Diff,
  DiffCounts,
  DiffGap,
  DiffHeader,
  DiffLine,
  DiffLines,
} from "@bandaso/ui/components/diff"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bandaso/ui/components/trace"
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
import { counts, lineDiff, type Line, parts } from "./diff"
import type { Tool } from "./thread"

/** A tool call's content as the window shows it: a diff with its lines. */
type Part =
  | Exclude<ToolContent, { kind: "diff" }>
  | (Extract<ToolContent, { kind: "diff" }> & {
      lines: Line[]
      added: number
      removed: number
    })

/** A tool call in a Thread: its line, and, opened, what it changed in
 * files, what it said and what its command printed. */
export function ToolCall({ tool }: { tool: Tool }) {
  const Icon = TOOL_ICONS[tool.tool]
  const shown = useMemo(
    () =>
      tool.content.map((part): Part => {
        if (part.kind !== "diff") return part
        const lines = lineDiff(part.old, part.new)
        return { ...part, lines, ...counts(lines) }
      }),
    [tool.content]
  )
  const total = { added: 0, removed: 0 }
  for (const part of shown)
    if (part.kind === "diff") {
      total.added += part.added
      total.removed += part.removed
    }
  // What its command prints shows where its terminal is, or else last.
  const terminal = shown.findIndex((part) => part.kind === "terminal")
  const running = tool.status === "pending" || tool.status === "running"
  const printed = (
    <Printed
      output={tool.output ?? { text: "", cut: false }}
      running={running}
    />
  )
  const line = (
    <TraceLine status={TOOL_STATUS[tool.status]}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>{tool.title}</TraceTitle>
      <DiffCounts {...total} />
    </TraceLine>
  )
  if (shown.length === 0 && !tool.output) return <Trace>{line}</Trace>
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {shown.map((part, at) => {
            switch (part.kind) {
              case "diff":
                return <FileChange key={at} {...part} />
              case "terminal":
                return (
                  at === terminal && <Fragment key={at}>{printed}</Fragment>
                )
              case "text":
                return (
                  <p
                    key={at}
                    className="max-h-80 overflow-auto whitespace-pre-wrap"
                  >
                    {part.text}
                  </p>
                )
            }
          })}
          {terminal < 0 && tool.output && printed}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** One file's change: its path, then the changed lines and a few around. */
function FileChange({
  path,
  old,
  lines,
  added,
  removed,
}: Extract<Part, { kind: "diff" }>) {
  const slash = path.lastIndexOf("/") + 1
  return (
    <Diff>
      <DiffHeader title={path}>
        <span className="min-w-0 truncate">
          <span className="text-muted-foreground">{path.slice(0, slash)}</span>
          {path.slice(slash)}
        </span>
        {old === undefined && (
          <span className="shrink-0 text-muted-foreground">New file</span>
        )}
        <DiffCounts added={added} removed={removed} className="ml-auto" />
      </DiffHeader>
      <DiffLines>
        {parts(lines).map((part, at) =>
          part.kind === "gap" ? (
            <DiffGap key={at}>
              ⋯ {part.lines} unchanged {part.lines === 1 ? "line" : "lines"}
            </DiffGap>
          ) : (
            <DiffLine key={at} kind={part.kind}>
              {part.text}
            </DiffLine>
          )
        )}
      </DiffLines>
    </Diff>
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
  const failed =
    exit !== undefined && ((exit.code ?? 0) !== 0 || exit.signal !== undefined)
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

const TOOL_STATUS: Record<
  ToolStatus,
  "running" | "error" | "pending" | undefined
> = {
  pending: "pending",
  running: "running",
  done: undefined,
  failed: "error",
}
