/**
 * A Thread's paths (ADR 0063, decision 2): the machine that has its
 * Project says which file each names, from the Thread's folder and the
 * folders its tools worked in (`files.locate`), and an action opens one.
 */
import { useLayoutEffect, useMemo } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Item } from "@banda/contract/agents"
import type { Located } from "@banda/contract/files"
import type { DeviceFile } from "@banda/core/react"
import type { FileAt, FilesHost } from "@banda/ui/components/markdown-file"
import { openInEditor } from "@banda/ui/lib/outside"
import type { PaneProps } from "@banda/ui/pane"
import type { ThreadArgs } from "./session"

/** At most this many full paths of the Thread's tools are sent. */
const WORKED = 24

/** What a Thread's files take from its Pane: how it runs an action, and
 * the device, which says whether a file is this computer's. */
export type FilesHands = Pick<
  PaneProps<ThreadArgs>,
  "run" | "device" | "file"
>

/**
 * The paths of a Thread in `project`, for its Markdown and its menu, as
 * the Project's machine finds them through the Pane's `engine`; none
 * where no window runs actions, as nothing could open one. `items` say
 * where its tools worked.
 */
export function useThreadFiles(
  engine: Pick<Engine, "call">,
  project: ProjectId,
  items: readonly Item[] | undefined,
  { run, device, file }: FilesHands
): ThreadFiles | null {
  const opens = run !== undefined
  const files = useMemo(
    () => (opens ? new ThreadFiles(engine, project) : null),
    [engine, project, opens]
  )
  useLayoutEffect(
    () => files?.follow(items ?? [], { run, device, file }),
    [files, items, run, device, file]
  )
  return files
}

/** A Thread's files, as its Project's machine finds them and the window's
 * actions open them: a missing one is the action's to say. */
export class ThreadFiles implements FilesHost {
  private items: readonly Item[] = []
  private hands: FilesHands = {}
  private readonly engine: Pick<Engine, "call">
  private readonly project: ProjectId

  constructor(engine: Pick<Engine, "call">, project: ProjectId) {
    this.engine = engine
    this.project = project
  }

  /** The Thread as it is now: where its tools worked, and what its Pane
   * holds. */
  follow(items: readonly Item[], hands: FilesHands): void {
    this.items = items
    this.hands = hands
  }

  /** One call to the Project's machine, which a read waits on while it
   * is away, so the path stays text till it is back. */
  find(paths: string[]): Promise<Located[]> {
    return this.engine.call(
      "files.locate",
      { paths, worked: workedOf(this.items) },
      { project: this.project }
    )
  }

  /** The file as this computer holds it, none for another machine's:
   * what opens it outside Banda takes only this (ADR 0106, decision 3). */
  private local(at: Located): DeviceFile | undefined {
    const { device, file } = this.hands
    return device && file ? device.local(file(at.file)) : undefined
  }

  onDevice(at: Located): boolean {
    return this.local(at) !== undefined
  }

  /** A click opens it in Files; Ctrl or ⌘ with it, in the editor at its
   * line (ADR 0073, decision 12, as amended). Another machine's file has
   * none here, so it opens in Files then too. */
  open(at: FileAt, outside: boolean): void {
    if (outside && this.onDevice(at)) this.edit(at)
    else
      this.hands.run?.("file.open", {
        file: at.file,
        project: this.project,
        line: at.line ?? null,
      })
  }

  /** Shows it in Quick Look, over the desk (ADR 0073, decision 12). */
  peek(at: FileAt): void {
    this.hands.run?.("file.peek", { file: at.file, project: this.project })
  }

  /** Opens it in the app the system has for it. */
  system(at: FileAt): void {
    this.hands.run?.("file.outside", { file: at.file })
  }

  /** Opens it at its line in the editor `files.toml` names, or the first
   * found; in its app when none is. */
  edit(at: FileAt): void {
    const local = this.local(at)
    if (local) void openInEditor(local, at)
  }

  /** Shows the file in its folder, in the system's file manager. */
  show(at: FileAt): void {
    this.hands.run?.("file.folder", { file: at.file })
  }
}

/** A full path in a tool's title, as `Read /home/me/a.ts`: the engine
 * keeps a tool call's title, not the places ACP names. */
const FULL_PATH = /(?:^|[\s`'"(])(\/[^\s`'"()]+)/g

const WORKED_IN = new WeakMap<readonly Item[], string[]>()

/** The full paths the Thread's tools named, latest first: the files they
 * changed, and the paths in their titles. */
export function workedOf(items: readonly Item[]): string[] {
  const known = WORKED_IN.get(items)
  if (known) return known
  const named = new Set<string>()
  for (let n = items.length - 1; n >= 0 && named.size < WORKED; n--) {
    const { body } = items[n]
    if (body.kind !== "tool") continue
    for (const content of body.content)
      if (content.kind === "diff" && content.path.startsWith("/"))
        named.add(content.path)
    for (const match of body.title.matchAll(FULL_PATH)) named.add(match[1])
  }
  const worked = [...named].slice(0, WORKED)
  WORKED_IN.set(items, worked)
  return worked
}
