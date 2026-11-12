import { useCallback } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { useFileMint } from "@banda/ui/hooks/use-file-url"

/** Resolves the media paths in this Thread's replies on `engine`, the
 * Pane's session: the machine that has its Project gives a token for a
 * picture, a video or a sound alone (`bytes.issue`, `media`), which the
 * desktop relays to it (ADR 0106, step 4c). Asked again as that engine
 * restarts. */
export function ThreadMedia({
  engine,
  project,
  children,
}: {
  engine: Engine
  project: ProjectId
  children: React.ReactNode
}) {
  const mint = useFileMint(engine, project, "media")
  const resolve = useCallback(
    (path: string) => {
      if (!mint) return Promise.resolve(null)
      // Markdown escapes spaces and Unicode in destinations once.
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        return Promise.resolve(null)
      }
      return mint(decoded)
    },
    [mint]
  )
  return <MarkdownMedia resolve={resolve}>{children}</MarkdownMedia>
}
