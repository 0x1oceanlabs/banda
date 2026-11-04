import { useCallback } from "react"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import type { AgentsHost } from "./desktop"

/** Resolves paths in this Thread's Space through Banda's own bridge. */
export function ThreadMedia({
  space,
  children,
}: {
  space: string
  children: React.ReactNode
}) {
  const resolve = useCallback(
    (path: string) => {
      const host = (window as unknown as { banda?: { agents: AgentsHost } })
        .banda
      // Markdown escapes spaces and Unicode in destinations once.
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        return Promise.resolve(null)
      }
      return host?.agents.media(space, decoded) ?? Promise.resolve(null)
    },
    [space]
  )
  return <MarkdownMedia resolve={resolve}>{children}</MarkdownMedia>
}
