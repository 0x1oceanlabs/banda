/**
 * `files.file`: one file, drawn as what it is (ADR 0073, decisions 2 and
 * 6): code and text numbered and coloured as the Diff draws them, opened
 * at a line; markdown rendered, its source a toggle away; an image to zoom
 * and pan; anything else its facts. It reads again as the file changes on
 * disk. Its header opens it in an editor at its line, or shows it in the
 * system's file manager (step F2). It only reads: editing comes later
 * (step F4).
 */
import { useEffect, useState } from "react"
import { Button } from "@banda/ui/components/button"
import { CodeFile, type LineRange } from "@banda/ui/components/code-file"
import { CopyButton } from "@banda/ui/components/copy-button"
import { InHeader } from "@banda/ui/components/pane-header"
import { Spinner } from "@banda/ui/components/spinner"
import {
  FILE_MANAGER,
  openInEditor,
  openWithSystem,
  reveal,
  useEditors,
} from "@banda/ui/lib/outside"
import { fromFolder, nameAndFolder } from "@banda/ui/lib/paths"
import type { ProjectId } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
import { definePane, type PaneProps, paneOf } from "@banda/ui/pane"
import {
  AppWindowIcon,
  CodeIcon,
  FileIcon,
  FileWarningIcon,
  FolderDownIcon,
  SquareCodeIcon,
  WrapTextIcon,
  XIcon,
} from "lucide-react"
import { Card, Facts, Gone } from "./Facts"
import { HeaderButton } from "./HeaderButton"
import { ImageView } from "./ImageView"
import { lineIn, MOST_LINES, rangeText } from "./lines"
import { sizeWords } from "./look"
import { MarkdownView } from "./MarkdownView"
import { type Shown, useFile } from "./read"

export type FileArgs = {
  /** The file, whole or from the Project's folder. */
  path: string
  /** The line it opens at, centred and lit once. */
  line?: number | null
  /** Long lines wrap, in code and in markdown's source. */
  wrap?: boolean
  /** Markdown shows its source, as code. */
  source?: boolean
}

export const filePane = definePane<FileArgs>({
  kind: "files.file",
  title: (args) => nameAndFolder(args.path).name,
  detail: (args) => nameAndFolder(args.path).folder ?? null,
  icon: FileIcon,
  // One Pane per file: opened again, it goes to the line asked for.
  identity: (args) => args.path,
  Pane: FilePane,
})

/** Opens the file at `path` beside the focused Pane, at `line`; a Pane
 * that shows it already gets the focus, and goes to that line. */
export function openFile(
  window: WindowApi,
  path: string,
  line: number | null,
  project?: ProjectId
): void {
  window.open(paneOf(filePane, { path, line }), project, {
    again: false,
    update: true,
  })
}

function FilePane({
  engine,
  project,
  args,
  update,
  label,
  run,
}: PaneProps<FileArgs>) {
  const shown = useFile(engine, project, args.path)
  const file = shown.state === "file" ? shown : null
  // The path as the Person reads it: from the Project's folder when it is
  // inside, else whole.
  const path = file ? fromFolder(file.stat.path, file.root) : args.path

  // Recent lists it, and `files.find` raises it (ADR 0073, decision 11).
  const opened = file?.stat.path
  useEffect(() => {
    if (opened)
      void engine
        .command("files.opened", { path: opened }, project)
        .catch(() => undefined)
  }, [engine, project, opened])

  // Its header names it as found: its folder from the Project's.
  useEffect(() => {
    if (!file) return
    const { name, folder } = nameAndFolder(path)
    label?.({ title: name, detail: folder ?? null })
  }, [label, file, path])

  const set = (next: Partial<FileArgs>) => update({ ...args, ...next })
  const wrap = args.wrap ?? false
  const source = args.source ?? false
  const asCode =
    file?.text?.text !== undefined &&
    (file.look === "code" || (file.look === "markdown" && source))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Wrap first: it comes and goes, and Source stays where it is. */}
      {asCode && (
        <InHeader>
          <HeaderButton
            label="Wrap lines"
            on={wrap}
            onClick={() => set({ wrap: !wrap })}
          >
            <WrapTextIcon />
          </HeaderButton>
        </InHeader>
      )}
      {file?.look === "markdown" && file.text?.text !== undefined && (
        <InHeader>
          <HeaderButton
            label="Source"
            on={source}
            onClick={() => set({ source: !source })}
          >
            <CodeIcon />
          </HeaderButton>
        </InHeader>
      )}
      {file && <Outside path={file.stat.path} line={args.line ?? null} />}
      <Body
        shown={shown}
        path={path}
        project={project}
        line={args.line}
        wrap={wrap}
        source={source}
        run={run}
      />
    </div>
  )
}

/** The header's way out of Banda: the file in the editor `files.toml`
 * names, at the line it opened at, or in its app when none is found; and
 * the file in its folder. */
function Outside({ path, line }: { path: string; line: number | null }) {
  const { editor } = useEditors()
  const at = line ? ` at line ${line}` : ""
  return (
    <InHeader>
      {editor ? (
        <HeaderButton
          label={`Open in ${editor.name}`}
          title={`Open in ${editor.name}${at}`}
          onClick={() => void openInEditor(path, { line })}
        >
          <SquareCodeIcon />
        </HeaderButton>
      ) : (
        <HeaderButton
          label="Open with the system"
          onClick={() => openWithSystem(path)}
        >
          <AppWindowIcon />
        </HeaderButton>
      )}
      <HeaderButton
        label={`Reveal in ${FILE_MANAGER}`}
        onClick={() => reveal(path)}
      >
        <FolderDownIcon />
      </HeaderButton>
    </InHeader>
  )
}

function Body({
  shown,
  path,
  project,
  line,
  wrap,
  source,
  run,
}: {
  shown: Shown
  path: string
  project: string
  line: number | null | undefined
  wrap: boolean
  source: boolean
  run: PaneProps<FileArgs>["run"]
}) {
  // An image that could not be drawn shows its facts instead.
  const [broken, setBroken] = useState<string>()
  switch (shown.state) {
    case "loading":
      return (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      )
    case "refused":
      return (
        <Card
          icon={<FileWarningIcon />}
          title="This file cannot be read"
          note={shown.message}
        />
      )
    case "gone":
      return <Gone path={path} />
  }
  const { stat, look, text } = shown
  const { name } = nameAndFolder(stat.path)
  if (look === "image" && broken !== stat.path)
    return (
      <ImageView
        project={project}
        path={stat.path}
        name={name}
        version={stat.modified}
        onBroken={() => setBroken(stat.path)}
      />
    )
  if (look === "image")
    return <Facts stat={stat} note="This image could not be drawn." />
  if (look === "folder")
    return (
      <Facts
        stat={stat}
        note="A folder shows in Files' tree, which comes next."
      />
    )
  if (!text || text.text === undefined)
    return (
      <Facts
        stat={stat}
        note={
          text?.binary
            ? "This file is binary. No preview for it yet."
            : "No preview for this kind yet."
        }
      />
    )
  const note = text.cut && (
    <p className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
      Only the start of this {sizeWords(text.bytes)} file is shown: its first{" "}
      {text.lines >= MOST_LINES
        ? `${MOST_LINES.toLocaleString("en")} lines`
        : "1 MB"}
      .
    </p>
  )
  if (look === "markdown" && !source)
    return (
      <>
        {note}
        <MarkdownView
          project={project}
          file={stat.path}
          text={text.text}
          run={run}
        />
      </>
    )
  return (
    <>
      {note}
      <Code
        key={stat.path}
        name={name}
        path={path}
        text={text.text}
        wrap={wrap}
        line={lineIn(line, text.lines)}
      />
    </>
  )
}

/** Code and text, opened at a line; the lines picked in its gutter can be
 * copied as `path:12-20`. */
function Code({
  name,
  path,
  text,
  wrap,
  line,
}: {
  name: string
  path: string
  text: string
  wrap: boolean
  line: number | null
}) {
  const [picked, setPicked] = useState<LineRange | null>(null)
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape" && picked) {
          event.stopPropagation()
          setPicked(null)
        }
      }}
    >
      <CodeFile
        className="min-h-0 flex-1"
        name={name}
        text={text}
        wrap={wrap}
        line={line}
        picked={picked}
        onPick={setPicked}
      />
      {picked && (
        <Picked
          text={rangeText(path, picked)}
          onClear={() => setPicked(null)}
        />
      )}
    </div>
  )
}

/** The lines picked, as an Agent reads them, to copy. Adding a comment on
 * them for the Agent comes next (step F2). */
function Picked({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <div
      role="status"
      aria-label="Picked lines"
      className="absolute bottom-2.5 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 rounded-lg bg-popover/80 py-0.5 pr-0.5 pl-2.5 text-xs text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur"
    >
      <span className="truncate font-mono">{text}</span>
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
