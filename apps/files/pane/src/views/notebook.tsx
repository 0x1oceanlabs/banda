/**
 * Files' notebooks (ADR 0073, decision 6): a Jupyter notebook's cells as
 * it saved them, and nothing run. Markdown cells are drawn as a reply's
 * markdown is, their own pictures too; code cells read-only in the code
 * view, coloured as their kernel's language; their saved outputs as
 * text, pictures, or HTML drawn as a reply's HTML is: sanitized, with no
 * scripts and no styles, as the sandbox host takes no HTML that is not a
 * file. An output that needs its scripts shows its text. A cell is
 * drawn as it comes near the view.
 */
import { useMemo, useRef, useState } from "react"
import { CodeLines } from "@banda/ui/components/code-file"
import { Markdown } from "@banda/ui/components/markdown"
import { InHeader } from "@banda/ui/components/pane-header"
import { cn } from "@banda/ui/lib/utils"
import type { PreviewProps } from "@banda/ui/module"
import { CodeIcon, FileWarningIcon, ShieldCheckIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import {
  attachedOf,
  type Cell,
  extensionFor,
  needsScripts,
  type Notebook,
  notebookOf,
  type Output,
  outputHtml,
} from "../notebook"
import CodeView from "./code"
import { MarkdownIn } from "./markdown"
import { useNear } from "./near"
import { useWhole } from "./whole"

/** A code view's line, and the room above and below its lines, in px,
 * to guess a cell's height before it is drawn. */
const LINE = 20
const PAD = 12

export default function NotebookView(props: PreviewProps) {
  const { kept, keep } = props
  const source = kept.source === true
  return (
    <>
      <InHeader>
        <HeaderButton
          label="Source"
          on={source}
          onClick={() => keep({ ...kept, source: !source })}
        >
          <CodeIcon />
        </HeaderButton>
      </InHeader>
      {source ? <CodeView {...props} /> : <Cells {...props} />}
    </>
  )
}

function Cells(props: PreviewProps) {
  const whole = useWhole(props)
  const book = useMemo((): { notebook: Notebook } | { why: string } | null => {
    if (!whole) return null
    if ("refused" in whole) return { why: whole.refused }
    try {
      const text = new TextDecoder().decode(whole.answer.bytes)
      return { notebook: notebookOf(JSON.parse(text)) }
    } catch (error) {
      return { why: (error as Error).message }
    }
  }, [whole])
  const scroller = useRef<HTMLDivElement>(null)
  if (book === null) return <Loading />
  if ("why" in book)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This notebook cannot be read"
        note={book.why}
      />
    )
  const { notebook } = book
  const name = `cell.${extensionFor(notebook.language)}`
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-auto select-text"
      aria-label="Cells"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
        <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          Saved outputs only. Code is never executed.
        </p>
        {notebook.cells.map((cell, index) => (
          <Near key={index} scroller={scroller} guess={guessOf(cell)}>
            <CellView cell={cell} name={name} {...props} />
          </Near>
        ))}
      </div>
    </div>
  )
}

/** How tall a cell is likely, in px, before it is drawn. */
function guessOf(cell: Cell): number {
  const lines = cell.source.split("\n").length
  const outputs = cell.kind === "code" ? cell.outputs.length * 60 : 0
  return lines * (cell.kind === "code" ? LINE : 24) + PAD + outputs
}

/** What is drawn only once it comes near the view; its likely height
 * till then. */
function Near({
  scroller,
  guess,
  children,
}: {
  scroller: React.RefObject<HTMLDivElement | null>
  guess: number
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNear(box, scroller, "800px 0px")
  // Once drawn, it stays: its height is known then.
  const [seen, setSeen] = useState(false)
  if (near && !seen) setSeen(true)
  return (
    <div ref={box} style={seen ? undefined : { height: guess }}>
      {seen && children}
    </div>
  )
}

function CellView({
  cell,
  name,
  file,
  engine,
  project,
  run,
}: { cell: Cell; name: string } & PreviewProps) {
  if (cell.kind === "markdown") {
    const { text, pictures } = attachedOf(cell.source, cell.attachments)
    return (
      <div data-cell="markdown" className="px-2 py-1">
        <MarkdownIn
          engine={engine}
          project={project}
          file={file.path}
          text={text}
          run={run}
          pictures={pictures}
        />
      </div>
    )
  }
  if (cell.kind === "raw")
    return (
      <pre
        data-cell="raw"
        className="rounded-card bg-muted/40 px-3 py-2 font-mono text-meta whitespace-pre-wrap"
      >
        {cell.source}
      </pre>
    )
  return (
    <div data-cell="code" className="flex flex-col gap-2">
      <div className="flex gap-2">
        <span className="w-10 shrink-0 pt-1.5 text-right font-mono text-meta text-muted-foreground">
          [{cell.count ?? " "}]
        </span>
        <CodeLines
          name={name}
          text={cell.source}
          className="min-w-0 flex-1 overflow-hidden rounded-card ring-1 ring-foreground/10"
        />
      </div>
      {cell.outputs.map((output, index) => (
        <div key={index} className="flex gap-2">
          <span className="w-10 shrink-0" />
          <OutputView output={output} />
        </div>
      ))}
    </div>
  )
}

function OutputView({ output }: { output: Output }) {
  switch (output.kind) {
    case "image":
      return (
        // A plot drawn on no background shows on white, as on paper.
        <img
          src={output.src}
          alt="An output"
          className="max-w-full self-start rounded-small bg-white p-1"
        />
      )
    case "markdown":
      return (
        <div className="min-w-0 flex-1 text-ui">
          <Markdown>{output.text}</Markdown>
        </div>
      )
    case "html":
      if (needsScripts(output.html) && output.text !== undefined)
        return (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Text text={output.text} />
            <p className="text-meta text-muted-foreground">
              This output needs its scripts, which Files does not run.
            </p>
          </div>
        )
      return (
        <div
          data-output="html"
          className="min-w-0 flex-1 overflow-x-auto text-meta"
        >
          <Markdown>{outputHtml(output.html)}</Markdown>
        </div>
      )
    case "text":
      return <Text text={output.text} stream={output.stream} />
  }
}

function Text({
  text,
  stream,
}: {
  text: string
  stream?: "stdout" | "stderr" | "error"
}) {
  return (
    <pre
      className={cn(
        "min-w-0 flex-1 overflow-x-auto rounded-small px-2 py-1 font-mono text-meta whitespace-pre-wrap",
        stream === "stderr" && "bg-amber-500/10",
        stream === "error" && "bg-destructive/10 text-destructive"
      )}
    >
      {text}
    </pre>
  )
}
