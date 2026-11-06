/**
 * Files' markdown (ADR 0073, decision 6), rendered as the Thread renders a
 * reply: `@banda/ui`'s Streamdown, its front matter a quiet line above
 * it, its source a toggle away. Its pictures come from the file host, a
 * relative one from the file's folder; a web link opens in Banda's
 * browser, and with Ctrl or ⌘ outside it, as in a Thread (ADR 0051).
 */
import { useCallback, useMemo } from "react"
import { Markdown } from "@banda/ui/components/markdown"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { InHeader } from "@banda/ui/components/pane-header"
import { fileMint } from "@banda/ui/hooks/use-file-url"
import type { PreviewProps } from "@banda/ui/module"
import { CodeIcon, FileWarningIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import { frontMatter } from "../markdown"
import { besideFile } from "../paths"
import { useText } from "../read"
import { Cut, TextOf, WrapButton } from "./code"

export default function MarkdownView(props: PreviewProps) {
  const { file, engine, project, kept, keep } = props
  const read = useText(engine, project, file.path, file.modified)
  const source = kept.source === true
  if (read === null) return <Loading />
  if ("refused" in read)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This file cannot be read"
        note={read.refused}
      />
    )
  const { drawn } = read
  return (
    <>
      {/* Wrap first: it comes and goes, and Source stays where it is. */}
      {source && drawn.text !== undefined && (
        <WrapButton kept={kept} keep={keep} />
      )}
      {drawn.text !== undefined && (
        <InHeader>
          <HeaderButton
            label="Source"
            on={source}
            onClick={() => keep({ ...kept, source: !source })}
          >
            <CodeIcon />
          </HeaderButton>
        </InHeader>
      )}
      {source || drawn.text === undefined ? (
        <TextOf {...props} drawn={drawn} wrap={kept.wrap === true} />
      ) : (
        <>
          <Cut drawn={drawn} />
          <Rendered
            project={project}
            file={file.path}
            text={drawn.text}
            run={props.run}
          />
        </>
      )}
    </>
  )
}

function Rendered({
  project,
  file,
  text,
  run,
}: {
  project: string
  /** Its full path. */
  file: string
  text: string
  run: PreviewProps["run"]
}) {
  const front = useMemo(() => frontMatter(text), [text])
  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {front && front.facts.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {front.facts.map(([key, value]) => (
              <span key={key}>
                {key}: <span className="text-foreground/80">{value}</span>
              </span>
            ))}
          </p>
        )}
        <MarkdownIn
          project={project}
          file={file}
          text={front?.body ?? text}
          run={run}
        />
      </div>
    </div>
  )
}

/** Markdown of a file, as a reply's is drawn: its pictures from the file
 * host, a relative one from the file's folder, or from `pictures` by
 * the name a link gives, as a notebook keeps its own; a web link in
 * Banda's browser, and with Ctrl or ⌘ outside it. */
export function MarkdownIn({
  project,
  file,
  text,
  run,
  pictures,
}: {
  project: string
  /** Its full path. */
  file: string
  text: string
  run: PreviewProps["run"]
  /** Pictures by the name a link gives them, as `attachment:dot.png`. */
  pictures?: Readonly<Record<string, string>>
}) {
  const mint = useMemo(() => fileMint(project), [project])
  const resolve = useCallback(
    (src: string) => {
      const own = pictures?.[src]
      if (own) return Promise.resolve(own)
      const path = besideFile(file, src)
      return path && mint ? mint(path) : Promise.resolve(null)
    },
    [mint, file, pictures]
  )
  const open = useCallback(
    (address: string, outside: boolean) => {
      if (outside) window.open(address, "_blank", "noopener,noreferrer")
      else run?.("browser.open", { address, project })
    },
    [run, project]
  )
  return (
    <MarkdownMedia resolve={resolve}>
      <MarkdownLinks open={open}>
        <Markdown>{text}</Markdown>
      </MarkdownLinks>
    </MarkdownMedia>
  )
}
