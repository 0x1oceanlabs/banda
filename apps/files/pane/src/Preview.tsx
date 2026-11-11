/**
 * A file, drawn by the previewer that claims it (ADR 0073, decision 6):
 * of every module's, the one the Person picked for its extension in
 * `files.toml`, else the one that matches it best, by its name, its MIME
 * type, or the bytes it starts with. Its view is loaded as it is first
 * needed, and is given the next file of its kind rather than drawn anew.
 * In Quick Look, a kind whose previewer cannot draw there shows its
 * facts; in Files' Columns and Gallery, its info (`Look`).
 */
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import type { Engine, JsonValue, ProjectId } from "@banda/contract"
import { FILES_FILE, type Stat } from "@banda/contract/files"
import { useDark } from "@banda/ui/hooks/use-dark"
import { useFileUrl } from "@banda/ui/hooks/use-file-url"
import { useFile as useLookFile } from "@banda/ui/lib/look"
import { nameAndFolder } from "@banda/ui/lib/paths"
import {
  headLength,
  pickPreviewer,
  previewOf,
  readBytes,
  usePreviewers,
  wantsHead,
} from "@banda/ui/lib/previewers"
import type { Bytes, Previewer, PreviewProps } from "@banda/ui/module"
import { Card, Facts, Gone, Loading } from "./Facts"
import { useFile } from "./read"
import { FileWarningIcon } from "lucide-react"

type Kept = { [key: string]: JsonValue }

export function Preview({
  stat,
  shown,
  mode,
  line,
  engine,
  project,
  run,
  local,
  kept,
  keep,
  instead,
  after,
}: {
  stat: Stat
  /** The file as the Person reads it. */
  shown: string
  mode: PreviewProps["mode"]
  line: number | null
  engine: Engine
  project: ProjectId
  run: PreviewProps["run"]
  local?: PreviewProps["local"]
  kept: Kept
  keep: (kept: Kept) => void
  /** What shows where no previewer draws the file here; its facts when
   * none is given. */
  instead?: ReactNode
  /** What shows under the file where a previewer draws it. */
  after?: ReactNode
}) {
  const url = useFileUrl(engine, project, stat.path, stat.modified)
  const previewer = usePicked(stat, url)
  const signal = useSignal(`${stat.path}\0${stat.modified}`)
  const read = useCallback(
    (range?: Bytes) => readBytes(url, range, signal),
    [url, signal]
  )
  const theme = useDark() ? "dark" : "light"
  if (previewer === undefined) return <Loading />
  if (
    instead &&
    (previewer === null || (mode === "quick" && !previewer.can.quick))
  )
    return instead
  if (previewer === null)
    return <Facts stat={stat} note="No preview for this kind yet." />
  if (mode === "quick" && !previewer.can.quick)
    return (
      <Facts
        stat={stat}
        note={`Quick Look does not draw a ${previewer.title}: ↵ opens it.`}
      />
    )
  const view = (
    <Suspense fallback={<Loading />}>
      {previewOf(previewer, {
        file: {
          path: stat.path,
          shown,
          name: nameAndFolder(stat.path).name,
          mime: stat.mime ?? null,
          size: stat.size ?? null,
          modified: stat.modified ?? null,
          url,
        },
        read,
        mode,
        line,
        theme,
        signal,
        engine,
        project,
        run,
        local,
        kept,
        keep,
      })}
    </Suspense>
  )
  if (!after) return view
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">{view}</div>
      {after}
    </div>
  )
}

const NOTHING_KEPT: Kept = {}

/**
 * The file at the whole `path` drawn small inside a view of Files, as
 * Columns' last column and the Gallery's big preview draw it: by its
 * previewer in quick mode, which keeps nothing; `instead` for a folder,
 * or a file no previewer draws so. It follows the disk.
 */
export function Look({
  engine,
  project,
  path,
  run,
  local,
  instead,
  after,
}: {
  engine: Engine
  project: ProjectId
  path: string
  run: PreviewProps["run"]
  local?: PreviewProps["local"]
  instead: ReactNode
  /** What shows under the file where it is drawn, as its info. */
  after?: ReactNode
}) {
  const shown = useFile(engine, project, path)
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
  if (shown.stat.kind === "folder") return instead
  return (
    <Preview
      stat={shown.stat}
      shown={path}
      mode="quick"
      line={null}
      engine={engine}
      project={project}
      run={run}
      local={local}
      kept={NOTHING_KEPT}
      keep={() => {}}
      instead={instead}
      after={after}
    />
  )
}

/** The previewer that draws `stat`: undefined while the bytes it starts
 * with are read from `url` to tell, null when none draws it. */
export function usePicked(
  stat: Pick<Stat, "path" | "mime">,
  url: string | null | undefined
): Previewer | null | undefined {
  const all = usePreviewers()
  const picks = useLookFile(FILES_FILE).previewers
  const known = { path: stat.path, mime: stat.mime ?? null }
  const wants = wantsHead(all, known)
  const head = useHead(wants ? url : null, headLength(all))
  if (wants && head === undefined) return undefined
  return pickPreviewer(all, { ...known, head: head ?? undefined }, picks)
}

/** The first `length` bytes at `url`: undefined while they are read,
 * null when they cannot be, or none are asked for. */
function useHead(
  url: string | null | undefined,
  length: number
): Uint8Array | null | undefined {
  const [head, setHead] = useState<{ url: string; bytes: Uint8Array | null }>()
  useEffect(() => {
    if (!url) return
    let current = true
    readBytes(url, { from: 0, to: length - 1 }).then(
      (bytes) => current && setHead({ url, bytes }),
      () => current && setHead({ url, bytes: null })
    )
    return () => {
      current = false
    }
  }, [url, length])
  if (url === null) return null
  return url !== undefined && head?.url === url ? head.bytes : undefined
}

/** A signal aborted once `key` changes, or the view goes. */
function useSignal(key: string): AbortSignal {
  const [held, setHeld] = useState(() => ({
    key,
    controller: new AbortController(),
  }))
  if (held.key !== key) setHeld({ key, controller: new AbortController() })
  // Aborted a moment after its effect goes, unless it comes again at
  // once, as React's strict mode has it do.
  const going = useRef<{ controller: AbortController; timer: number }>(null)
  useEffect(() => {
    const { controller } = held
    if (going.current?.controller === controller)
      clearTimeout(going.current.timer)
    return () => {
      going.current = {
        controller,
        timer: window.setTimeout(() => controller.abort()),
      }
    }
  }, [held])
  return held.controller.signal
}
