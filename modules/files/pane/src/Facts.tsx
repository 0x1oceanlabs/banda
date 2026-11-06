/**
 * What `files.file` shows of a file it draws no picture of: its facts,
 * quietly, and why there is nothing more.
 */
import type { ReactNode } from "react"
import type { Stat } from "@banda/contract/files"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { nameAndFolder } from "@banda/ui/lib/paths"
import { FileIcon, FileXIcon, FolderIcon } from "lucide-react"
import { kindWords, sizeWords } from "./look"

/** When it last changed, as a clock and a calendar read it. */
const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function Facts({ stat, note }: { stat: Stat; note: string }) {
  const facts: [string, string | undefined][] = [
    ["Kind", kindWords(stat)],
    ["Type", stat.mime],
    ["Size", stat.size === undefined ? undefined : sizeWords(stat.size)],
    [
      "Modified",
      stat.modified === undefined ? undefined : WHEN.format(stat.modified),
    ],
  ]
  const Icon = stat.kind === "folder" ? FolderIcon : FileIcon
  return (
    <Card icon={<Icon />} title={nameAndFolder(stat.path).name} note={note}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-left text-xs">
        {facts.map(([term, value]) =>
          value === undefined ? null : (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="truncate">{value}</dd>
            </div>
          )
        )}
      </dl>
    </Card>
  )
}

/** A file not there: where it was looked for. */
export function Gone({ path }: { path: string }) {
  return (
    <Card icon={<FileXIcon />} title="This file is gone">
      <p className="text-xs break-all text-muted-foreground select-text">
        {path}
      </p>
    </Card>
  )
}

/** What `files.file` says where it shows no file: an icon, a title, and
 * a few quiet words, as the Diff says it has nothing to draw. */
export function Card({
  icon,
  title,
  note,
  children,
}: {
  icon: ReactNode
  title: string
  note?: string
  children?: ReactNode
}) {
  return (
    <Empty className="min-h-0 overflow-auto">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-7 [&_svg]:stroke-[1.5]">
          {icon}
        </EmptyMedia>
        <EmptyTitle className="max-w-full truncate">{title}</EmptyTitle>
        {children}
        {note && (
          <EmptyDescription className="text-xs">{note}</EmptyDescription>
        )}
      </EmptyHeader>
    </Empty>
  )
}
