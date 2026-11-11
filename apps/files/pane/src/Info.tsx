/**
 * The info of the row picked (ADR 0073, step F6), from `files.info`: a
 * quiet panel beside the List or the Gallery, or under the preview in
 * Columns' last column. Its small picture, or its icon; then its kind and
 * type, its size (a folder's counted as asked, and stopped), its times,
 * its permissions and owner, where a link leads; a picture's size and
 * what its camera wrote; and the last commit that changed it. What was
 * shown stays until the next row's comes, so moving the pick is quiet.
 */
import { useCallback, useEffect, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Counted, Info } from "@banda/contract/files"
import { Button } from "@banda/ui/components/button"
import { FileIcon } from "@banda/ui/components/file-icon"
import { useRead } from "@banda/ui/hooks/use-read"
import { cn } from "@banda/ui/lib/utils"
import { FolderIcon, LinkIcon } from "lucide-react"
import { useThumb } from "./thumbs"
import { nameOf } from "./where"
import {
  agoWords,
  countWords,
  kindWords,
  modeWords,
  sizeWords,
  WHEN,
} from "./words"

/** How wide its picture is drawn, in px. */
const PICTURE = 224

export function InfoPane({
  engine,
  project,
  path,
  modified,
  picture = true,
  className,
}: {
  engine: Engine
  project: ProjectId
  /** The row's whole path. */
  path: string
  /** Its time as listed: its info is read again as it changes. */
  modified?: number | null
  /** Its small picture, or its icon, heads it: not under a preview that
   * shows the file already. */
  picture?: boolean
  className?: string
}) {
  const read = useRead(
    useCallback(
      () => engine.call("files.info", { path }, { project }),
      // Read again as the file changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [engine, project, path, modified]
    )
  )
  // What was shown stays until the next comes.
  const [shown, setShown] = useState<Info | null>(null)
  if (read.state === "ready" && read.value !== shown) setShown(read.value)
  return (
    <section
      aria-label="Info"
      className={cn(
        "@container flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-xs",
        className
      )}
    >
      {read.state === "refused" ? (
        <p className="text-muted-foreground">{read.refusal.message}</p>
      ) : shown ? (
        <Facts
          engine={engine}
          project={project}
          info={shown}
          pictured={picture}
        />
      ) : null}
    </section>
  )
}

function Facts({
  engine,
  project,
  info,
  pictured,
}: {
  engine: Engine
  project: ProjectId
  info: Info
  pictured: boolean
}) {
  const folder = info.kind === "folder" || info.items !== undefined
  const picture = useThumb(
    engine,
    project,
    folder || info.dangling || !pictured
      ? null
      : { path: info.path, modified: info.modified, size: info.size },
    PICTURE
  )
  const kind = kindWords({
    path: info.path,
    kind: folder ? "folder" : "file",
    mime: info.mime,
  })
  const exif = info.exif
  return (
    <>
      <header className="flex flex-col items-center gap-2 text-center">
        {pictured && (
          <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-control">
            {picture ? (
              <img
                src={picture}
                alt=""
                className="max-h-full max-w-full rounded-control object-contain ring-1 ring-foreground/10"
              />
            ) : folder ? (
              <FolderIcon className="size-12 stroke-[1.25] text-muted-foreground" />
            ) : (
              <FileIcon
                path={info.path}
                className="size-12 text-muted-foreground"
              />
            )}
          </div>
        )}
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-ui font-medium select-text">
            {nameOf(info.path)}
          </h3>
          <p className="text-muted-foreground">
            {kind}
            {info.size != null && ` · ${sizeWords(info.size)}`}
            {info.items != null && ` · ${countWords(info.items, "item")}`}
          </p>
        </div>
      </header>
      <Rows
        rows={[
          ["Kind", kind],
          ["Type", info.mime],
          [
            "Size",
            info.size != null ? (
              `${sizeWords(info.size)} (${info.size.toLocaleString("en")} bytes)`
            ) : folder ? (
              <FolderSize engine={engine} project={project} path={info.path} />
            ) : null,
          ],
          [
            "Dimensions",
            info.picture && `${info.picture.width} × ${info.picture.height} px`,
          ],
          ["Created", when(info.created)],
          ["Modified", when(info.modified)],
          ["Opened", when(info.accessed)],
          ["Permissions", info.mode != null && modeWords(info.mode)],
          [
            "Owner",
            info.owner &&
              (info.group && info.group !== info.owner
                ? `${info.owner}, group ${info.group}`
                : info.owner),
          ],
          [
            "Link to",
            info.link && (
              <span className="flex min-w-0 items-center gap-1">
                <LinkIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono select-text">
                  {info.link}
                </span>
                {info.dangling && (
                  <span className="shrink-0 text-muted-foreground">
                    · leads nowhere
                  </span>
                )}
              </span>
            ),
          ],
        ]}
      />
      {exif && (
        <Rows
          label="Camera"
          rows={[
            ["Camera", exif.camera],
            ["Lens", exif.lens],
            ["Taken", exif.taken],
            ["Exposure", exif.exposure],
            ["Place", exif.place],
          ]}
        />
      )}
      {info.commit && (
        <Rows
          label="Last commit"
          rows={[
            ["Subject", info.commit.subject],
            ["Author", info.commit.author],
            [
              "When",
              <span key="when" title={WHEN.format(info.commit.when)}>
                {agoWords(info.commit.when)}
              </span>,
            ],
            [
              "Commit",
              <span key="hash" className="font-mono select-text">
                {info.commit.hash.slice(0, 10)}
              </span>,
            ],
          ]}
        />
      )}
    </>
  )
}

/** A time as a clock and a calendar read it. */
const when = (time: number | undefined) =>
  time === undefined ? null : WHEN.format(time)

/** Facts, a term and its value each, those with none left out; under a
 * quiet heading, when it has one. */
function Rows({
  label,
  rows,
}: {
  label?: string
  rows: readonly [string, React.ReactNode][]
}) {
  const shown = rows.filter(([, value]) => value != null && value !== false)
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border-t pt-3">
      {label && (
        <h4 className="text-meta font-medium text-muted-foreground">
          {label}
        </h4>
      )}
      {/* Each term over its value in a narrow panel; beside it in one
          wide enough. */}
      <dl className="grid grid-cols-1 gap-x-3 @[15rem]:grid-cols-[auto_minmax(0,1fr)] @[15rem]:gap-y-1">
        {shown.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="mb-1 min-w-0 break-words select-text @[15rem]:mb-0">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** A folder's size: counted as asked, as it goes, and stopped by Stop or
 * by going to another row. */
function FolderSize({
  engine,
  project,
  path,
}: {
  engine: Engine
  project: ProjectId
  path: string
}) {
  const [counting, setCounting] = useState<{
    path: string
    counted: Counted | null
  } | null>(null)
  const asked = counting?.path === path
  const running = asked && counting.counted?.done !== true
  useEffect(() => {
    if (!asked || !running) return
    return engine.stream(
      project,
      "files.size",
      { path },
      (counted) => setCounting({ path, counted }),
      () => {}
    )
    // It runs once per ask, until it is done or let go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, project, path, asked])
  const counted = asked ? counting.counted : null
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {counted && (
        <span>
          {sizeWords(counted.bytes)}, {countWords(counted.files, "file")}
          {!counted.done && "…"}
        </span>
      )}
      {running ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto p-0 text-xs"
          onClick={() => setCounting(null)}
        >
          Stop
        </Button>
      ) : (
        !counted?.done && (
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs"
            onClick={() => setCounting({ path, counted: null })}
          >
            Count
          </Button>
        )
      )}
    </span>
  )
}
