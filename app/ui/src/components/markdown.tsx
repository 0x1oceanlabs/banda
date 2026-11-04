import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { cn } from "cn"
import { useMemo } from "react"

import { Streamdown, defaultRehypePlugins } from "streamdown"
import { useDiagramLook } from "../lib/diagram-look"
import { localImages } from "../lib/markdown-media"
import { MarkdownImage } from "./markdown-media"
import { MarkdownLink } from "./markdown-link"

/** Single-dollar math matches what Agents write; KaTeX leaves code alone. */
const math = createMathPlugin({ singleDollarTextMath: true })
const plugins = { code, math, mermaid }
const components = { img: MarkdownImage, a: MarkdownLink }

const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  localImages(),
  defaultRehypePlugins.harden,
  localImages(true),
]

/** Copy on code, tables and diagrams; diagrams can open fullscreen, where
 * they zoom and pan. In the reply a diagram stays still, so the thread
 * scrolls over it (`globals.css`, the diagram card). */
const controls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: { copy: true, download: false, fullscreen: true },
} as const

/**
 * Markdown as an Agent writes it, such as a reply or a thought (ADR 0010,
 * decision 2). While `streaming`, unfinished markdown closes as it comes
 * and Copy waits for the end. The host supplies web-link navigation
 * through MarkdownLinks (ADR 0051).
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
  const diagram = useDiagramLook()
  const mermaid = useMemo(() => ({ config: diagram }), [diagram])
  return (
    <Streamdown
      data-slot="markdown"
      className={cn(
        "min-w-0 space-y-3 text-prose wrap-break-word *:first:mt-0 *:last:mb-0",
        className
      )}
      isAnimating={streaming}
      plugins={plugins}
      mermaid={mermaid}
      components={components}
      rehypePlugins={rehypePlugins}
      controls={controls}
      linkSafety={{ enabled: false }}
    >
      {children}
    </Streamdown>
  )
}

export { Markdown }
