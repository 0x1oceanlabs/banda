/**
 * A markdown file in `files.file`, rendered as the Thread renders a reply:
 * `@banda/ui`'s Streamdown, its front matter a quiet line above it. Its
 * pictures come from the file host, a relative one from the file's
 * folder; a web link opens in Banda's browser, and with Ctrl or ⌘
 * outside it, as in a Thread (ADR 0051).
 */
import { useCallback, useMemo } from "react"
import { Markdown } from "@banda/ui/components/markdown"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { fileMint } from "@banda/ui/hooks/use-file-url"
import type { PaneProps } from "@banda/ui/pane"
import { frontMatter } from "./markdown"
import { besideFile } from "./paths"

export function MarkdownView({
  project,
  file,
  text,
  run,
}: {
  project: string
  /** Its full path. */
  file: string
  text: string
  run: PaneProps<never>["run"]
}) {
  const mint = useMemo(() => fileMint(project), [project])
  const resolve = useCallback(
    (src: string) => {
      const path = besideFile(file, src)
      return path && mint ? mint(path) : Promise.resolve(null)
    },
    [mint, file]
  )
  const open = useCallback(
    (address: string, outside: boolean) => {
      if (outside) window.open(address, "_blank", "noopener,noreferrer")
      else run?.("browser.open", { address, project })
    },
    [run, project]
  )
  const front = useMemo(() => frontMatter(text), [text])
  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {front && front.facts.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {front.facts.map(([key, value]) => (
              <span key={key}>
                {key}: <span className="text-foreground/80">{value}</span>
              </span>
            ))}
          </p>
        )}
        <MarkdownMedia resolve={resolve}>
          <MarkdownLinks open={open}>
            <Markdown>{front?.body ?? text}</Markdown>
          </MarkdownLinks>
        </MarkdownMedia>
      </div>
    </div>
  )
}
