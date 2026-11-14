/**
 * Files' markdown (ADR 0073, decision 6), rendered as the Thread renders a
 * reply: `@banda/ui`'s Streamdown, its front matter a quiet line above
 * it, its source a toggle away. Its pictures come from the file host, a
 * relative one from the file's folder; a web link opens in Banda's
 * browser, and with Ctrl or ⌘ outside it, as in a Thread (ADR 0051). A
 * task's box ticked writes its line, and Edit edits its source (decision
 * 8).
 */
import { useCallback, useMemo } from "react"
import { linkRefused, usePlaced } from "@banda/core/react"
import { Markdown } from "@banda/ui/components/markdown"
import { MarkdownLinks } from "@banda/ui/components/markdown-link"
import { MarkdownMedia } from "@banda/ui/components/markdown-media"
import { MarkdownTasks, type Tick } from "@banda/ui/components/markdown-task"
import { InHeader } from "@banda/ui/components/pane-header"
import { useFileMint } from "@banda/ui/hooks/use-file-url"
import { linkHint } from "@banda/ui/lib/links"
import type { PreviewProps } from "@banda/ui/module"
import type { Engine } from "@banda/contract"
import { CodeIcon, FileWarningIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import { frontMatter } from "../markdown"
import { besideFile } from "../paths"
import { Cut, TextOf, WrapButton } from "./code"
import { Edited, EditButton, useEditing } from "./edit"

export default function MarkdownView(props: PreviewProps) {
  const { file, engine, project, kept, keep } = props
  const edit = useEditing(props)
  const { read, text, tick } = edit
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
  // Edit edits its source.
  const code = source || edit.on
  return (
    <>
      <EditButton edit={edit} />
      {/* Wrap first: it comes and goes, and Source stays where it is. */}
      {code && drawn.text !== undefined && (
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
      <Edited edit={edit} props={props}>
        {code || text === undefined ? (
          <TextOf
            {...props}
            drawn={drawn}
            text={text}
            editor={edit.editor}
            wrap={kept.wrap === true}
          />
        ) : (
          <>
            <Cut drawn={drawn} />
            <Rendered
              engine={engine}
              project={project}
              file={file.path}
              text={text}
              run={props.run}
              tick={tick}
            />
          </>
        )}
      </Edited>
    </>
  )
}

function Rendered({
  engine,
  project,
  file,
  text,
  run,
  tick,
}: {
  engine: Engine
  project: string
  /** Its full path. */
  file: string
  text: string
  run: PreviewProps["run"]
  /** Ticks a task counted from where the body starts; none where the
   * file may not be written. */
  tick: ((nth: number, done: boolean, of: number, from: number) => void) | null
}) {
  const front = useMemo(() => frontMatter(text), [text])
  const body = front?.body ?? text
  // Its tasks are counted in its body, after the front matter.
  const from = text.length - body.length
  const ticks = useMemo<Tick | null>(
    () => tick && ((nth, done, of) => tick(nth, done, of, from)),
    [tick, from]
  )
  return (
    <div className="min-h-0 flex-1 overflow-auto select-text">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {front && front.facts.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-3 text-meta text-muted-foreground">
            {front.facts.map(([key, value]) => (
              <span key={key}>
                {key}: <span className="text-foreground/80">{value}</span>
              </span>
            ))}
          </p>
        )}
        <MarkdownTasks tick={ticks}>
          <MarkdownIn
            engine={engine}
            project={project}
            file={file}
            text={body}
            run={run}
          />
        </MarkdownTasks>
      </div>
    </div>
  )
}

/** Markdown of a file, as a reply's is drawn: its pictures from the file
 * host by `engine`, the Pane's session, a relative one from the file's
 * folder, or from `pictures` by the name a link gives, as a notebook
 * keeps its own; a web link in Banda's browser, and with Ctrl or ⌘
 * outside it. */
export function MarkdownIn({
  engine,
  project,
  file,
  text,
  run,
  pictures,
}: {
  engine: Engine
  project: string
  /** Its full path. */
  file: string
  text: string
  run: PreviewProps["run"]
  /** Pictures by the name a link gives them, as `attachment:dot.png`. */
  pictures?: Readonly<Record<string, string>>
}) {
  const mint = useFileMint(engine, project)
  const resolve = useCallback(
    (src: string) => {
      const own = pictures?.[src]
      if (own) return Promise.resolve(own)
      const path = besideFile(file, src)
      return path && mint ? mint(path) : Promise.resolve(null)
    },
    [mint, file, pictures]
  )
  // Banda's browser runs on this machine alone, so a link in another
  // machine's file opens in this device's browser, an address of that
  // machine's own as the window opens it (ADR 0106, decision 3; ADR 0120,
  // decision 2).
  const { host, shown } = usePlaced(project, undefined)
  const machine = host && (shown?.named.name ?? host)
  const open = useCallback(
    (address: string, outside: boolean) => {
      // The window weighs the rest: this device's browser, and an address
      // of that machine's own through a forward, or whose it is.
      if (!machine && !outside) run?.("browser.open", { address, project })
      else run?.("link.open", { url: address })
    },
    [run, project, machine]
  )
  const hint = useCallback(
    (address: string) =>
      machine
        ? (linkRefused(address, machine)?.why ??
          `${address}\nOpens in this computer's browser`)
        : linkHint(address),
    [machine]
  )
  return (
    <MarkdownMedia resolve={resolve}>
      <MarkdownLinks open={open} hint={hint}>
        <Markdown>{text}</Markdown>
      </MarkdownLinks>
    </MarkdownMedia>
  )
}
