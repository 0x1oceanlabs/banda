import { useCallback } from "react"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { agentsHost } from "../desktop"

/** Resolves paths in this Thread's Project through Banda's own bridge. */
export function ThreadMedia({
  project,
  children,
}: {
  project: string
  children: React.ReactNode
}) {
  const resolve = useCallback(
    (path: string) => {
      // Markdown escapes spaces and Unicode in destinations once.
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        return Promise.resolve(null)
      }
      return agentsHost()?.media(project, decoded) ?? Promise.resolve(null)
    },
    [project]
  )
  return <MarkdownMedia resolve={resolve}>{children}</MarkdownMedia>
}
