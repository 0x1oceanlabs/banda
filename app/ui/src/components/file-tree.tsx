/**
 * The files of a change as a tree, as T3 Code's Diff shows them:
 * `@pierre/trees`, folders open, a folder of one folder folded into its
 * path, each file tinted by how it changed (ADR 0034, decision 2).
 */
import type { GitStatusEntry } from "@pierre/trees"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useEffect, useRef } from "react"
import { useDark } from "../hooks/use-dark"
import { cn } from "cn"

export type { GitStatus } from "@pierre/trees"

/** A file of the tree, and how it changed. */
export type TreeFile = GitStatusEntry

export type FileTreeProps = {
  files: readonly TreeFile[]
  /** The file shown now, marked in the tree. */
  selected: string | null
  onSelect: (path: string) => void
  className?: string
}

/** A tree drawn again whole when its files change: Pierre's model keeps
 * the paths it was made with. */
export function ChangedFiles(props: FileTreeProps) {
  const key = props.files
    .map((file) => `${file.status}:${file.path}`)
    .join("\n")
  return <Tree key={key} {...props} />
}

function Tree({ files, selected, onSelect, className }: FileTreeProps) {
  const dark = useDark()
  // The model keeps the first handler it is given.
  const chosen = useRef(onSelect)
  useEffect(() => {
    chosen.current = onSelect
  })
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    gitStatus: files,
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    search: false,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)
      if (path && !path.endsWith("/")) chosen.current(path)
    },
    unsafeCSS: CSS,
  })
  useEffect(() => {
    if (selected === null) return
    const item = model.getItem(selected)
    if (item && !model.getSelectedPaths().includes(selected)) {
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect()
      item.select()
      model.scrollToPath(selected)
    }
  }, [model, selected])
  return (
    <FileTree
      model={model}
      className={cn("block h-full min-h-0", className)}
      style={{ colorScheme: dark ? "dark" : "light" }}
    />
  )
}

const CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-override: var(--foreground);
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
    --trees-git-added-color-override: var(--added);
    --trees-git-deleted-color-override: var(--removed);
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
  button[data-type='item'], button[data-type='item']::before { border-radius: calc(var(--radius) - 4px); }
`
