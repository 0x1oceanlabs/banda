import { code } from "@streamdown/code"
import { cn } from "cn"
import { Streamdown } from "streamdown"

/** Shiki highlights code in the theme's light and dark. */
const plugins = { code }

/** Copy on code and tables, nothing to download, no diagrams' extras. */
const controls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: false,
} as const

/**
 * Markdown as an Agent writes it, such as a reply or a thought (ADR 0010,
 * decision 2). While `streaming`, unfinished markdown closes as it comes
 * and Copy waits for the end. A link opens in the Person's browser: the
 * window sends every web address there.
 */
function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string
  streaming?: boolean
  className?: string
}) {
  return (
    <Streamdown
      data-slot="markdown"
      className={cn(
        "min-w-0 text-sm leading-relaxed wrap-break-word *:first:mt-0 *:last:mb-0",
        className
      )}
      isAnimating={streaming}
      plugins={plugins}
      controls={controls}
      linkSafety={{ enabled: false }}
    >
      {children}
    </Streamdown>
  )
}

export { Markdown }
