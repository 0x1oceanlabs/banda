/**
 * Files' code and text (ADR 0073, decision 6): a file's text, numbered and
 * coloured as the Diff draws it, opened at a line. Its lines picked in the
 * gutter copy as `path:12-20`, or take a comment that goes into a
 * Thread's message with them; in Quick Look it only shows. Past 1 MiB or
 * 20 000 lines its start is drawn, and a note says so; a file that turns
 * out binary shows its facts.
 */
import { useState } from "react"
import { Button } from "@banda/ui/components/button"
import {
  CodeFile,
  type LineRange,
  linesWords,
} from "@banda/ui/components/code-file"
import { CopyButton } from "@banda/ui/components/copy-button"
import { InHeader } from "@banda/ui/components/pane-header"
import type { PreviewProps } from "@banda/ui/module"
import {
  FileWarningIcon,
  MessageSquarePlusIcon,
  WrapTextIcon,
  XIcon,
} from "lucide-react"
import { Card, Facts, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import { lineIn, linesOf, MOST_LINES, rangeText } from "../lines"
import { type Drawn, useText } from "../read"
import { useHolding } from "../work"
import { sizeWords } from "../words"

export default function CodeView(props: PreviewProps) {
  const { file, engine, project, kept, keep } = props
  const read = useText(engine, project, file.path, file.modified)
  const wrap = kept.wrap === true
  return (
    <>
      {read && "drawn" in read && read.drawn.text !== undefined && (
        <WrapButton kept={kept} keep={keep} />
      )}
      {read === null ? (
        <Loading />
      ) : "refused" in read ? (
        <Card
          icon={<FileWarningIcon />}
          title="This file cannot be read"
          note={read.refused}
        />
      ) : (
        <TextOf {...props} drawn={read.drawn} wrap={wrap} />
      )}
    </>
  )
}

/** The header's Wrap, kept with the Pane. */
export function WrapButton({
  kept,
  keep,
}: Pick<PreviewProps, "kept" | "keep">) {
  const wrap = kept.wrap === true
  return (
    <InHeader>
      <HeaderButton
        label="Wrap lines"
        on={wrap}
        onClick={() => keep({ ...kept, wrap: !wrap })}
      >
        <WrapTextIcon />
      </HeaderButton>
    </InHeader>
  )
}

/** A file's text, drawn as code: its facts when it has none to draw. */
export function TextOf({
  file,
  drawn,
  wrap,
  mode,
  line,
  project,
  run,
}: PreviewProps & { drawn: Drawn; wrap: boolean }) {
  if (drawn.text === undefined)
    return (
      <Facts
        stat={file}
        note={
          drawn.binary
            ? "This file is binary. No preview for it yet."
            : "No preview for this kind yet."
        }
      />
    )
  return (
    <>
      <Cut drawn={drawn} />
      <Code
        project={project}
        name={file.name}
        path={file.shown}
        whole={file.path}
        text={drawn.text}
        wrap={wrap}
        line={lineIn(line, drawn.lines)}
        pick={mode === "pane"}
        run={run}
      />
    </>
  )
}

/** Says when only the start of a long file is drawn. */
export function Cut({ drawn }: { drawn: Drawn }) {
  if (!drawn.cut) return null
  return (
    <p className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
      Only the start of this {sizeWords(drawn.bytes)} file is shown: its first{" "}
      {drawn.lines >= MOST_LINES
        ? `${MOST_LINES.toLocaleString("en")} lines`
        : "1 MB"}
      .
    </p>
  )
}

/** Code and text, opened at a line; the lines picked in its gutter can be
 * copied as `path:12-20`, or take a comment that goes into a Thread's
 * message with them (ADR 0034, decision 9). */
function Code({
  project,
  name,
  path,
  whole,
  text,
  wrap,
  line,
  pick,
  run,
}: {
  project: PreviewProps["project"]
  name: string
  /** The file as the Person reads it, and whole. */
  path: string
  whole: string
  text: string
  wrap: boolean
  line: number | null
  /** Its lines may be picked: not in Quick Look. */
  pick: boolean
  run: PreviewProps["run"]
}) {
  const [picked, setPicked] = useState<{
    whole: string
    range: LineRange
  } | null>(null)
  const [commenting, setCommenting] = useState(false)
  // Lines of another file are not picked here.
  const range = picked?.whole === whole ? picked.range : null
  // Lines picked, or a comment being written, keep Follow waiting.
  useHolding(project, range !== null)
  const clear = () => {
    setPicked(null)
    setCommenting(false)
  }
  return (
    <div
      data-code-view=""
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape" && range) {
          event.stopPropagation()
          clear()
        }
      }}
    >
      <CodeFile
        className="min-h-0 flex-1"
        name={name}
        text={text}
        wrap={wrap}
        line={line}
        picked={range}
        onPick={(range) => {
          if (!pick) return
          setPicked(range && { whole, range })
          setCommenting(false)
        }}
        comment={
          commenting && range
            ? {
                onComment: (comment) => {
                  const [from, to] = [
                    Math.min(range.start, range.end),
                    Math.max(range.start, range.end),
                  ]
                  run?.("file.attach", {
                    file: whole,
                    from,
                    to,
                    comment,
                    text: linesOf(text, from, to),
                  })
                  clear()
                },
                onCancel: () => setCommenting(false),
              }
            : null
        }
      />
      {range && !commenting && (
        <Picked
          text={rangeText(path, range)}
          lines={linesWords(range)}
          onComment={() => setCommenting(true)}
          onClear={clear}
        />
      )}
    </div>
  )
}

/** The lines picked, as an Agent reads them, to copy, or to comment on. */
function Picked({
  text,
  lines,
  onComment,
  onClear,
}: {
  text: string
  lines: string
  onComment: () => void
  onClear: () => void
}) {
  return (
    <div
      role="status"
      aria-label="Picked lines"
      className="absolute bottom-2.5 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 rounded-lg bg-popover/80 py-0.5 pr-0.5 pl-2.5 text-xs text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur"
    >
      <span className="truncate font-mono">{text}</span>
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        title={`Add a comment on lines ${lines} for the Agent`}
        onClick={onComment}
      >
        <MessageSquarePlusIcon />
        Add a comment…
      </Button>
      <CopyButton text={text} label={`Copy ${text}`} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Unpick the lines"
        title="Unpick · Esc"
        onClick={onClear}
      >
        <XIcon />
      </Button>
    </div>
  )
}
