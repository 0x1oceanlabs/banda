/**
 * Files' archives (ADR 0073, decision 6): what a zip, a tar, a gzipped
 * tar or a 7z holds, as a tree of its names with their sizes, read by the
 * engine's `files.archive`, which takes nothing out. A row picked shows
 * its facts at the foot. Taking files out comes later.
 */
import { useMemo, useState } from "react"
import { ListedTree } from "@banda/ui/components/file-tree"
import type { PreviewProps } from "@banda/ui/module"
import { FileWarningIcon } from "lucide-react"
import { summaryOf, treeOf } from "../archive"
import { Card, Loading } from "../Facts"
import { sizeWords, WHEN } from "../words"
import { useAnswer } from "./whole"

/** Up to this many names, every folder shows open. */
const ALL_OPEN = 200

export default function ArchiveView({ file, engine, project }: PreviewProps) {
  const listed = useAnswer(`${file.path}\0${file.modified}`, () =>
    engine.call("files.archive", { path: file.path }, { project })
  )
  const archive = listed && "answer" in listed ? listed.answer : null
  const tree = useMemo(() => archive && treeOf(archive.entries), [archive])
  const [picked, setPicked] = useState<string | null>(null)
  if (listed === null) return <Loading />
  if (!archive || !tree)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This archive cannot be listed"
        note={"refused" in listed ? listed.refused : undefined}
      />
    )
  const entry = picked === null ? undefined : tree.entries.get(picked)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b px-3 py-1.5 text-meta text-muted-foreground">
        {summaryOf(archive, file.size)}
        {archive.truncated &&
          ` · only its first ${archive.entries.length.toLocaleString("en")} names are listed`}
      </p>
      {tree.paths.length === 0 ? (
        <Card icon={<FileWarningIcon />} title="This archive is empty" />
      ) : (
        <ListedTree
          paths={tree.paths}
          notes={tree.notes}
          open={tree.paths.length <= ALL_OPEN ? "all" : "top"}
          onSelect={setPicked}
          label={`What ${file.name} holds`}
          className="min-h-0 flex-1 px-1 py-1"
        />
      )}
      <p className="shrink-0 truncate border-t px-3 py-1 text-meta text-muted-foreground">
        {entry
          ? [
              entry.path,
              entry.size === undefined ? null : sizeWords(entry.size),
              entry.packed === undefined
                ? null
                : `${sizeWords(entry.packed)} packed`,
              entry.modified === undefined ? null : WHEN.format(entry.modified),
            ]
              .filter(Boolean)
              .join(" · ")
          : "Read only: taking files out comes later."}
      </p>
    </div>
  )
}
