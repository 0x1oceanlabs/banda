import { useCallback } from "react"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { bytesUrl } from "@banda/ui/hooks/use-file-url"
import { agentsHost } from "../desktop"

/** Resolves paths in this Thread's Project to a token of this machine's
 * engine, through Banda's own bridge, and the URL that names it; none for
 * a Project of another host's (`project` null), whose paths are not this
 * machine's. */
export function ThreadMedia({
  project,
  children,
}: {
  project: string | null
  children: React.ReactNode
}) {
  const resolve = useCallback(
    (path: string) => {
      if (project === null) return Promise.resolve(null)
      // Markdown escapes spaces and Unicode in destinations once.
      let decoded: string
      try {
        decoded = decodeURIComponent(path)
      } catch {
        return Promise.resolve(null)
      }
      return (
        agentsHost()
          ?.media(project, decoded)
          .then((token) => (token ? bytesUrl(token, "media") : null)) ??
        Promise.resolve(null)
      )
    },
    [project]
  )
  return <MarkdownMedia resolve={resolve}>{children}</MarkdownMedia>
}
