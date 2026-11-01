import { DiffCounts, DiffPath } from "@bandaso/ui/components/diff"
import { FileDiffIcon } from "lucide-react"
import { type FileChange, total } from "./changes"

/**
 * The files a turn changed, under what it wrote (ADR 0010, decision 3). A
 * file, or the header for all of them, opens the turn's changes in a Diff
 * Pane beside the Thread.
 */
export function ChangedFiles({
  files,
  onOpen,
}: {
  files: FileChange[]
  /** Opens the turn's changes, on one file if `path` names it. */
  onOpen: (path?: string) => void
}) {
  const all = total(files)
  return (
    <section
      aria-label="Changed files"
      className="overflow-hidden rounded-xl border bg-card text-sm"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onOpen()}
      >
        <FileDiffIcon className="size-4 shrink-0" />
        <span className="font-medium">
          {files.length === 1
            ? "1 file changed"
            : `${files.length} files changed`}
        </span>
        <DiffCounts {...all} className="ml-auto" />
      </button>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              title={file.path}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted"
              onClick={() => onOpen(file.path)}
            >
              <DiffPath path={file.path} />
              {file.old === undefined && (
                <span className="shrink-0 font-sans text-muted-foreground">
                  New file
                </span>
              )}
              <DiffCounts
                added={file.added}
                removed={file.removed}
                className="ml-auto"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
