/**
 * A reply's code block (ADR 0063, decision 6), drawn as Streamdown draws
 * one, with Banda's actions: Run in terminal for one line of a shell,
 * Wrap lines, off at first, and Copy. A diagram keeps its source, which
 * its picture does not, for Copy (decision 4).
 */
import { PlayIcon, WrapTextIcon } from "lucide-react"
import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  CodeBlock,
  CodeBlockCopyButton,
  defaultComponents,
  type ExtraProps,
  useIsCodeFenceIncomplete,
} from "streamdown"
import { shellLine } from "../lib/shell-line"

/** Runs a shell's line where the host runs one; none where nothing can. */
type RunLine = (line: string) => void
const Shell = createContext<RunLine | null>(null)

/** The host's terminal, for the Markdown inside: without one, a block
 * offers no Run. */
export function MarkdownShell({
  run,
  children,
}: {
  run: RunLine | null
  children: ReactNode
}) {
  return <Shell value={run}>{children}</Shell>
}

const Code = defaultComponents.code!

type BlockProps = ComponentProps<"code"> & ExtraProps

/** A fenced block of a reply: a diagram, or code. Drawn again only when
 * what was written changes, as Streamdown's own. */
export const MarkdownBlock = memo(function MarkdownBlock(props: BlockProps) {
  const language = languageOf(props)
  const source = sourceOf(props.children)
  if (language !== "mermaid")
    return (
      <Block
        className={props.className}
        meta={metaOf(props)}
        language={language}
        source={source}
      />
    )
  return (
    <div className="contents" data-source={source}>
      <Code {...props} />
    </div>
  )
}, same)

/** Code, as Streamdown's own `code` draws it, with Banda's actions. */
function Block({
  className,
  meta,
  language,
  source,
}: {
  className?: string
  meta: string
  language: string
  source: string
}) {
  const incomplete = useIsCodeFenceIncomplete()
  const run = useContext(Shell)
  const [wrapped, setWrapped] = useState(false)
  const start = Number(/startLine=(\d+)/.exec(meta)?.[1])
  const line = run && !incomplete ? shellLine(language, source) : null
  return (
    <CodeBlock
      className={className}
      code={source}
      language={language}
      isIncomplete={incomplete}
      lineNumbers={!/\bnoLineNumbers\b/.test(meta)}
      startLine={start >= 1 ? start : undefined}
      data-wrap={wrapped || undefined}
    >
      {line && (
        <button
          type="button"
          data-act="run"
          title={`Run in terminal: ${line}`}
          onClick={() => run!(line)}
        >
          <PlayIcon aria-hidden size={14} />
          Run
        </button>
      )}
      <button
        type="button"
        data-act="wrap"
        aria-label="Wrap lines"
        aria-pressed={wrapped}
        title="Wrap lines"
        onClick={() => setWrapped(!wrapped)}
      >
        <WrapTextIcon aria-hidden size={14} />
      </button>
      <CodeBlockCopyButton data-act="copy" />
    </CodeBlock>
  )
}

const languageOf = ({ className }: BlockProps) =>
  /language-(\S+)/.exec(className ?? "")?.[1] ?? ""

const metaOf = ({ node }: BlockProps) =>
  String(node?.properties?.metastring ?? "")

/** Whether two blocks draw the same: the same language, code and meta. */
function same(was: BlockProps, now: BlockProps): boolean {
  return (
    was.className === now.className &&
    sourceOf(was.children) === sourceOf(now.children) &&
    metaOf(was) === metaOf(now)
  )
}

/** The code a fenced block holds, as Streamdown reads it. */
function sourceOf(children: ReactNode): string {
  if (typeof children === "string") return children
  if (isValidElement<{ children?: unknown }>(children)) {
    const inner = children.props.children
    if (typeof inner === "string") return inner
  }
  return ""
}
