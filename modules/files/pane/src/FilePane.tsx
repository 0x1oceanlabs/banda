/**
 * `files.file`: one file, drawn by the previewer that claims it (ADR 0073,
 * decisions 2 and 6): code numbered and coloured, markdown rendered, a
 * picture, a PDF, video and sound, a page in the sandbox; anything else
 * its facts. "Open with…" picks another previewer that draws it, kept for
 * its extension. It reads again as the file changes on disk. Its header
 * opens it in an editor at its line, or shows it in the system's file
 * manager (step F2); Files' Follow moves it to the file the Agent works
 * on.
 *
 * Quick Look is this Pane over the desk (decision 7, `PaneProps.peek`):
 * the tree under it keeps the keys and moves it, and the previewer's view
 * takes the next file of its kind rather than being drawn anew.
 *
 * Code and markdown are edited here (decision 8): a dot by the title
 * says the file has work not saved yet, and "Saved" says it was, for a
 * moment. Closing the Pane saves what waits to be.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { JsonValue, ProjectId } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { InHeader } from "@banda/ui/components/pane-header"
import {
  FILE_MANAGER,
  openInEditor,
  openWithSystem,
  reveal,
  useEditors,
} from "@banda/ui/lib/outside"
import { fromFolder, nameAndFolder } from "@banda/ui/lib/paths"
import {
  extensionOf,
  previewersFor,
  usePreviewers,
} from "@banda/ui/lib/previewers"
import type { Previewer, WindowApi } from "@banda/ui/module"
import { definePane, type PaneProps, paneOf } from "@banda/ui/pane"
import type { Stat } from "@banda/contract/files"
import {
  AppWindowIcon,
  EyeIcon,
  FileIcon,
  FileWarningIcon,
  FolderDownIcon,
  SquareCodeIcon,
} from "lucide-react"
import { draftKey, draftOf, hearDrafts } from "./draft"
import { Card, Facts, Gone, Loading } from "./Facts"
import { HeaderButton } from "./HeaderButton"
import { peeking } from "./peek"
import { Preview, usePicked } from "./Preview"
import { type Shown, useFile } from "./read"
import { showing, workedIn } from "./work"

export type FileArgs = {
  /** The file, whole or from the Project's folder. */
  path: string
  /** The line it opens at, centred and lit once. */
  line?: number | null
  /** Long lines wrap, in code and in markdown's source. */
  wrap?: boolean
  /** Markdown, or a page, shows its source, as code. */
  source?: boolean
  /** Its text is edited. */
  edit?: boolean
}

/** How long "Saved" shows by the title, in ms. */
const SAVED_FOR = 1_500

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

/** Shows the file at `path` in Quick Look, over the desk (ADR 0073,
 * decision 7); one shown already moves to it. */
export function peekFile(
  window: WindowApi,
  path: string,
  project?: ProjectId
): void {
  window.peek(paneOf(filePane, { path }), project)
}

type Kept = { [key: string]: JsonValue }

function FilePane({
  engine,
  project,
  args,
  update,
  label,
  run,
  close,
  focused,
  peek = false,
}: PaneProps<FileArgs>) {
  const shown = useFile(engine, project, args.path)
  const file = shown.state === "file" ? shown : null
  // The path as the Person reads it: from the Project's folder when it is
  // inside, else whole.
  const path = file ? fromFolder(file.stat.path, file.root) : args.path

  // Recent lists it, and `files.find` raises it (ADR 0073, decision 11);
  // a glance in Quick Look does not.
  const opened = peek ? undefined : file?.stat.path
  useEffect(() => {
    if (opened)
      void engine
        .command("files.opened", { path: opened }, project)
        .catch(() => undefined)
  }, [engine, project, opened])

  // Its header names it as found: its folder from the Project's; and
  // says whether its work is saved.
  const edits = useEdits(project, peek ? null : (file?.stat.path ?? null))
  useEffect(() => {
    if (!file) return
    const { name, folder } = nameAndFolder(path)
    label?.({ title: name, detail: folder ?? null, ...(edits && { edits }) })
  }, [label, file, path, edits])

  // The keys are its view's, which takes the focus from the tile, as the
  // tree does: once the text it draws is there.
  const root = useRef<HTMLDivElement>(null)
  const drawn = shown.state
  useEffect(() => {
    if (!focused || peek) return
    const until = performance.now() + 2_000
    const take = () => {
      const own = root.current
      const at = document.activeElement
      // Only from the tile itself: what has the focus inside keeps it.
      if (!own || !at || at === document.body || !at.contains(own)) return
      const view = own.querySelector<HTMLElement>("[data-keys]")
      if (view) view.focus({ preventScroll: true })
      else if (performance.now() < until) frame = requestAnimationFrame(take)
    }
    let frame = requestAnimationFrame(take)
    return () => cancelAnimationFrame(frame)
  }, [focused, peek, drawn])

  // Follow moves it to another file, at a line (ADR 0073, decision 9);
  // not Quick Look's, which the tree moves.
  const now = useRef({ args, update, close })
  useEffect(() => {
    now.current = { args, update, close }
  })
  useEffect(() => {
    if (peek) return
    return showing({
      project,
      path: () => now.current.args.path,
      go: (path, line) =>
        now.current.update({ ...now.current.args, path, line }),
    })
  }, [project, peek])
  // In Quick Look, the tree knows it shows, and how to close it.
  useEffect(() => {
    if (!peek) return
    const close = () => now.current.close()
    peeking(close)
    return () => peeking(null, close)
  }, [peek])

  // What the previewer keeps is the rest of the args.
  const { path: asked, line, ...kept } = args
  const keep = (next: Kept) =>
    update({ path: asked, line, ...next } as FileArgs)

  return (
    // A key or a click here, and text picked here, keep Follow waiting.
    <div
      ref={root}
      data-files={project}
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={() => workedIn(project)}
      onPointerDownCapture={() => workedIn(project)}
    >
      {file && !peek && file.stat.kind === "file" && (
        <OpenWith stat={file.stat} run={run} />
      )}
      {file && <Outside path={file.stat.path} line={args.line ?? null} />}
      <Body
        shown={shown}
        path={path}
        peek={peek}
        line={args.line ?? null}
        engine={engine}
        project={project}
        run={run}
        kept={kept as Kept}
        keep={keep}
      />
    </div>
  )
}

/** Whether the file at `path` has work not saved yet, or was saved a
 * moment ago, by its draft; none when neither, or no draft is kept. */
function useEdits(project: ProjectId, path: string | null) {
  const state = useSyncExternalStore(hearDrafts, () =>
    path === null ? null : (draftOf(draftKey(project, path))?.state ?? null)
  )
  const saved = state?.saved ?? null
  // "Saved" goes once its moment has passed.
  const [gone, setGone] = useState<number | null>(null)
  useEffect(() => {
    if (saved === null) return
    const timer = setTimeout(() => setGone(saved), SAVED_FOR)
    return () => clearTimeout(timer)
  }, [saved])
  if (!state) return undefined
  if (state.mine !== null || state.moved) return "unsaved" as const
  if (saved !== null && gone !== saved) return "saved" as const
  return undefined
}

/** "Open with…": the previewers that draw the file, the one that does now
 * picked; a pick is kept for its extension, in `files.toml`. */
function OpenWith({
  stat,
  run,
}: {
  stat: Stat
  run: PaneProps<FileArgs>["run"]
}) {
  const all = usePreviewers()
  // Only a file that its name or MIME type matches has more than one.
  const picked = usePicked(stat, null)
  const extension = extensionOf(stat.path)
  const others = previewersFor(all, { path: stat.path, mime: stat.mime })
  if (!picked || !extension || others.length < 2) return null
  return (
    <InHeader>
      <span className="order-last flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Open with…"
                title="Open with…"
                className="shrink-0"
              />
            }
          >
            <EyeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuRadioGroup
              value={picked.id}
              onValueChange={(id: string) =>
                run?.("files.previewer", { extension, previewer: id })
              }
            >
              <DropdownMenuLabel>
                Open .{extension} files with
              </DropdownMenuLabel>
              {others.map((one: Previewer) => (
                <DropdownMenuRadioItem key={one.id} value={one.id} closeOnClick>
                  {one.title}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </InHeader>
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
      {/* After what the previewer puts there, which comes once it loads. */}
      <span className="order-last flex items-center gap-px">
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
      </span>
    </InHeader>
  )
}

function Body({
  shown,
  path,
  peek,
  line,
  engine,
  project,
  run,
  kept,
  keep,
}: {
  shown: Shown
  path: string
  peek: boolean
} & Pick<
  Parameters<typeof Preview>[0],
  "line" | "engine" | "project" | "run" | "kept" | "keep"
>) {
  switch (shown.state) {
    case "loading":
      return <Loading />
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
  if (shown.stat.kind === "folder")
    return (
      <Facts
        stat={shown.stat}
        note={
          peek ? "A folder: ↵ goes into it." : "A folder shows in Files' tree."
        }
      />
    )
  return (
    <Preview
      stat={shown.stat}
      shown={path}
      mode={peek ? "quick" : "pane"}
      line={line}
      engine={engine}
      project={project}
      run={run}
      kept={kept}
      keep={keep}
    />
  )
}
