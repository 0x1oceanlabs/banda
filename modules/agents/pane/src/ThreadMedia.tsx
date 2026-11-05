import { useCallback } from "react"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { agentsHost } from "./desktop"

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
      // Markdown escapes spaces and Unicode in destinations once.
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        return Promise.resolve(null)
      }
      return agentsHost()?.media(space, decoded) ?? Promise.resolve(null)
    },
    [space]
  )
  return <MarkdownMedia resolve={resolve}>{children}</MarkdownMedia>
}
