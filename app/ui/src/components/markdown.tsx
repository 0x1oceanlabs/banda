import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { cn } from "cn"
import { Streamdown, defaultRehypePlugins } from "streamdown"
import { useDark } from "../hooks/use-dark"
import { localImages } from "../lib/markdown-media"
import { MarkdownImage } from "./markdown-media"

/** Single-dollar math matches what Agents write; KaTeX leaves code alone. */
const math = createMathPlugin({ singleDollarTextMath: true })
const plugins = { code, math, mermaid }
const diagrams = {
  light: { config: { theme: "default" as const } },
  dark: { config: { theme: "dark" as const } },
}
const components = { img: MarkdownImage }
const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  localImages(),
  defaultRehypePlugins.harden,
  localImages(true),
]

/** Copy on code, tables and diagrams; diagrams can open fullscreen. */
const controls = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: { copy: true, download: false, fullscreen: true },
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
  const dark = useDark()
  return (
    <Streamdown
      data-slot="markdown"
      className={cn(
        "min-w-0 text-sm leading-relaxed wrap-break-word *:first:mt-0 *:last:mb-0",
        className
      )}
      isAnimating={streaming}
      plugins={plugins}
      mermaid={dark ? diagrams.dark : diagrams.light}
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
