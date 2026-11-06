/**
 * A Thread's paths (ADR 0063, decision 2): the window's main process says
 * which file each names, from the Thread's folder and the folders its
 * tools worked in, and an action opens one.
 */
import { useLayoutEffect, useMemo } from "react"
import type { FoundFile, Item } from "@banda/contract/agents"
import type { FileAt, FilesHost } from "@banda/ui/components/markdown-file"
import { openInEditor } from "@banda/ui/lib/outside"
import type { PaneProps } from "@banda/ui/pane"
import { type AgentsHost, agentsHost } from "./desktop"
import type { ThreadArgs } from "./session"

/** At most this many full paths of the Thread's tools are sent. */
const WORKED = 24

type Run = NonNullable<PaneProps<ThreadArgs>["run"]>

/**
 * The paths of a Thread in `project`, for its Markdown and its menu; none
 * where no window looks at files. `items` say where its tools worked;
 * `run` opens a file.
 */
export function useThreadFiles(
  project: string,
  items: readonly Item[] | undefined,
  run: Run | undefined
): ThreadFiles | null {
  const files = useMemo(() => {
    const bridge = agentsHost()
    return bridge ? new ThreadFiles(bridge, project) : null
  }, [project])
  useLayoutEffect(() => files?.follow(items ?? [], run), [files, items, run])
  return files
}

/** A Thread's files, as main finds them and the window's actions open
 * them: a missing one is the action's to say. */
class ThreadFiles implements FilesHost {
  private items: readonly Item[] = []
  private run: Run | undefined
  private readonly bridge: AgentsHost
  private readonly project: string

  constructor(bridge: AgentsHost, project: string) {
    this.bridge = bridge
    this.project = project
  }

  /** The Thread as it is now: where its tools worked, and how it runs
   * an action. */
  follow(items: readonly Item[], run: Run | undefined): void {
    this.items = items
    this.run = run
  }

  find(paths: string[]): Promise<Array<FoundFile | null>> {
    return this.bridge.paths(this.project, paths, workedOf(this.items))
  }

  /** A click opens it in Files; Ctrl or ⌘ with it, in the editor at its
   * line (ADR 0073, decision 12, as amended). */
  open(at: FileAt, outside: boolean): void {
    if (outside) this.edit(at)
    else
      this.run?.("file.open", {
        file: at.file,
        project: this.project,
        line: at.line ?? null,
      })
  }

  /** Opens it in the app the system has for it. */
  system(at: FileAt): void {
    this.run?.("file.outside", { file: at.file })
  }

  /** Opens it at its line in the editor `files.toml` names, or the first
   * found; in its app when none is. */
  edit(at: FileAt): void {
    void openInEditor(at.file, at)
  }

  /** Shows the file in its folder, in the system's file manager. */
  show(at: FileAt): void {
    this.run?.("file.folder", { file: at.file })
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
