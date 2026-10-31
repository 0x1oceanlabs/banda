import { useMemo } from "react"
import type {
  Body,
  Output,
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

type Tool = Extract<Body, { kind: "tool" }>

/** A tool call in a Thread: its line, and, opened, what it changed in
 * files, what it said and what its command printed. */
export function ToolCall({ tool }: { tool: Tool }) {
  const Icon = TOOL_ICONS[tool.tool]
  const changes = useMemo(
    () =>
      tool.content.map((part) =>
        part.kind === "diff"
          ? { ...part, lines: lineDiff(part.old, part.new) }
          : part
      ),
    [tool.content]
  )
  const total = changes.reduce(
    (sum, part) => {
      if (part.kind !== "diff") return sum
      const { added, removed } = counts(part.lines)
      return { added: sum.added + added, removed: sum.removed + removed }
    },
    { added: 0, removed: 0 }
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
  if (changes.length === 0 && !tool.output) return <Trace>{line}</Trace>
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {changes.map((part, at) =>
            part.kind === "diff" ? (
              <FileChange key={at} {...part} />
            ) : (
              <p
                key={at}
                className="max-h-80 overflow-auto whitespace-pre-wrap"
              >
                {part.text}
              </p>
            )
          )}
          {tool.output && <Printed output={tool.output} />}
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
}: {
  path: string
  old?: string
  lines: Line[]
}) {
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
        <DiffCounts {...counts(lines)} className="ml-auto" />
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
function Printed({ output: { text, exit, cut } }: { output: Output }) {
  return (
    <Console>
      <ConsoleText>{text === "" ? "Nothing printed yet." : text}</ConsoleText>
      {(exit !== undefined || cut) && (
        <ConsoleFooter>
          {exit !== undefined && (
            <span className={exit === 0 ? undefined : "text-destructive"}>
              {exit === 0 ? "Finished." : `Ended with code ${exit}.`}
            </span>
          )}
          {cut && <span>The Thread keeps the first 64 KB of it.</span>}
        </ConsoleFooter>
      )}
    </Console>
  )
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
