import { useEffect, useMemo, useRef } from "react"
import type { ThreadId } from "@banda/contract/agents"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"
import { Spinner } from "@banda/ui/components/spinner"
import { definePane, type PaneProps } from "@banda/ui/pane"
import { FileDiffIcon } from "lucide-react"
import { changes } from "./changes"
import { useThread } from "./live-thread"
import { FileDiff } from "./FileDiff"

/**
 * What one turn of a Thread changed in files, file by file, beside the
 * Thread (ADR 0010, decision 3). `path` is the file it opened on; `title`
 * keeps the Thread's words for its header.
 */
export type DiffArgs = {
  thread: ThreadId
  turn: string
  path: string | null
  title: string
}

export const diffPane = definePane<DiffArgs>({
  kind: "agents.diff",
  module: "agents",
  title: (args) => (args.title ? `Changes · ${args.title}` : "Changes"),
  icon: FileDiffIcon,
  Pane: DiffPane,
})

function DiffPane({ engine, space, args }: PaneProps<DiffArgs>) {
  const live = useThread(engine, space, args.thread)
  const items = live.state === "ready" ? live.view.items : undefined
  const files = useMemo(
    () => (items ? changes(items, args.turn) : []),
    [items, args.turn]
  )
  // It opens on the file it was asked for, and again when asked for another.
  const list = useRef<HTMLDivElement>(null)
  const ready = live.state === "ready"
  useEffect(() => {
    if (!ready || args.path === null) return
    const box = list.current
    const file = box?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(args.path)}"]`
    )
    // Only the list scrolls: the window and its Strip stay where they are.
    if (box && file) box.scrollTo({ top: file.offsetTop - 16 })
  }, [ready, args.path])

  if (live.state === "loading")
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  if (live.state === "refused")
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {live.refusal.message}
      </p>
    )
  if (files.length === 0)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>No changes</EmptyTitle>
          <EmptyDescription>This turn changed no files.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div
      ref={list}
      aria-label="Changes"
      className="relative flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4"
    >
      {files.map((file) => (
        <div key={file.path} data-path={file.path}>
          <FileDiff {...file} />
        </div>
      ))}
    </div>
  )
}
