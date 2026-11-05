import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { cn } from "../lib/utils"
import { useId, useMemo, type ComponentProps } from "react"

import {
  Streamdown,
  defaultComponents,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type ExtraProps,
  type StreamdownProps,
} from "streamdown"
import { useDiagramLook } from "../lib/diagram-look"
import { fileUrls, proseFiles, TEXT_PATH } from "../lib/markdown-paths"
import { MarkdownCode, MarkdownTextPath, Written } from "./markdown-file"
import { MarkdownImage } from "./markdown-media"
import { MarkdownLink } from "./markdown-link"

/** Single-dollar math matches what Agents write; KaTeX leaves code alone. */
const math = createMathPlugin({ singleDollarTextMath: true })
const plugins = { code, math, mermaid }
const Code = defaultComponents.code!

/** A code block, as Streamdown draws it. A diagram keeps its source,
 * which its picture does not, for Copy (ADR 0063, decision 4). */
function MarkdownBlock(props: ComponentProps<"code"> & ExtraProps) {
  if (!/\blanguage-mermaid\b/.test(props.className ?? ""))
    return <Code {...props} />
  return (
    <div className="contents" data-source={String(props.children ?? "")}>
      <Code {...props} />
    </div>
  )
}

// A path in plain text is marked with a tag of Banda's own (ADR 0063,
// decision 2).
const components = {
  img: MarkdownImage,
  a: MarkdownLink,
  code: MarkdownBlock,
  inlineCode: MarkdownCode,
  [TEXT_PATH]: MarkdownTextPath,
} as StreamdownProps["components"]

const remarkPlugins = [...Object.values(defaultRemarkPlugins), fileUrls]

// The sanitizer keeps a link's and an image's schemes to the web's; it
// is all rehype-harden did, as Streamdown lets every prefix and scheme
// through, but harden also blocked a path to a local file (ADR 0063).
const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  proseFiles,
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
 * through MarkdownLinks (ADR 0051), and its files through MarkdownFiles
 * (ADR 0063): a path is looked at once the Markdown is written.
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
  // A reply's notes have ids of their own, so two replies' never mix
  // (ADR 0063, decision 1), and show their label.
  const scope = useId()
  const notes = useMemo(
    () => ({
      clobberPrefix: `${scope}-`,
      footnoteLabel: "Notes",
      footnoteLabelProperties: {},
    }),
    [scope]
  )
  return (
    <Written value={!streaming}>
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
        remarkRehypeOptions={notes}
        controls={controls}
        linkSafety={{ enabled: false }}
        remarkPlugins={remarkPlugins}
      >
        {children}
      </Streamdown>
    </Written>
  )
}

export { Markdown }
