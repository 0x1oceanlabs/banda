import { Button } from "@banda/ui/components/button"
import { DiffCounts } from "@banda/ui/components/diff"
import { FileDiffIcon } from "lucide-react"
import { Card } from "../../entries/parts/Card"
import { type FileChange, total } from "../../entries/parts/changes"

/**
 * The files a turn changed, under what it wrote (ADR 0010, decision 3), as
 * a card with a verb (ADR 0058, decision 7): "Edited 2 files +38 −9".
 * Review opens the turn's changes in a Diff Pane beside the Thread; a file
 * opens them on that file.
 */
export function ChangedFiles({
  files,
  onOpen,
}: {
  files: FileChange[]
  /** Opens the turn's changes, on one file if `path` names it. */
  onOpen: (path?: string) => void
}) {
  return (
    <Card
      region
      icon={<FileDiffIcon />}
      title={`Edited ${files.length} ${files.length === 1 ? "file" : "files"}`}
      label="Changed files"
      detail={<DiffCounts {...total(files)} />}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => onOpen()}
        >
          Review
        </Button>
      }
      className="overflow-hidden"
    >
      <ul>
        {files.map((file) => (
          <li key={file.path} className="border-t">
            <button
              type="button"
              title={file.path}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-code transition-colors outline-none hover:bg-raised focus-visible:bg-raised"
              onClick={() => onOpen(file.path)}
            >
              <FilePath path={file.path} />
              {file.old === undefined && (
                <span className="shrink-0 font-sans text-xs text-muted-foreground">
                  new
                </span>
              )}
              <DiffCounts added={file.added} removed={file.removed} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** A file's path: its folder dimmed, cut short first, and its name. */
function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf("/") + 1
  return (
    <span className="flex min-w-0 flex-1">
      <span className="truncate text-muted-foreground">
        {path.slice(0, slash)}
      </span>
      <span className="max-w-full shrink-0 truncate">{path.slice(slash)}</span>
    </span>
  )
}
