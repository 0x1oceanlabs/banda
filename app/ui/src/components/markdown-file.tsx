import type { FoundFile } from "@banda/contract/agents"
import { FileIcon } from "lucide-react"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react"
import { defaultComponents, type ExtraProps } from "streamdown"
import { finder } from "../lib/file-finder"
import {
  codePath,
  fileUrl,
  lineText,
  named,
  type Named,
} from "../lib/file-links"
import { linkHint, outsideClick } from "../lib/links"
import { nameAndFolder } from "../lib/paths"

/** A found file, and the line its path points at. */
export type FileAt = FoundFile & Omit<Named, "path">

/** What the host does with a reply's paths (ADR 0063, decision 2). */
export type FilesHost = {
  /** The file each path names, if one is there, in their order. */
  find: (paths: string[]) => Promise<Array<FoundFile | null>>
  /** Opens it in Banda, or, with Ctrl or ⌘, in its app. */
  open: (file: FileAt, outside: boolean) => void
}

type Files = {
  find: (path: string) => Promise<FoundFile | null>
  open: FilesHost["open"]
}
const Files = createContext<Files | null>(null)

/** The host's paths for the Markdown inside, the paths drawn together
 * asked for in one call; without a host, a path is only text. */
export function MarkdownFiles({
  host,
  children,
}: {
  host: FilesHost | null
  children: ReactNode
}) {
  const files = useMemo(
    () =>
      host && {
        find: finder((paths) => host.find(paths)),
        open: (at: FileAt, outside: boolean) => host.open(at, outside),
      },
    [host]
  )
  return <Files value={files}>{children}</Files>
}

/** Whether the Markdown is written in full: its paths are looked at then,
 * not as each letter streams in. */
export const Written = createContext(true)

/** The file `path` names: undefined while it is looked for, null when
 * there is none. */
function useFound(path: string | undefined): FoundFile | null | undefined {
  const files = useContext(Files)
  const written = useContext(Written)
  const [found, setFound] = useState<{ path: string; file: FoundFile | null }>()
  useEffect(() => {
    if (!files || !path || !written) return
    let current = true
    const settle = (file: FoundFile | null) => {
      if (current) setFound({ path, file })
    }
    files.find(path).then(settle, () => settle(null))
    return () => {
      current = false
    }
  }, [files, path, written])
  return found && found.path === path ? found.file : undefined
}

const Code = defaultComponents.code!

/** Inline code, as Streamdown draws it; a path to a file there is a chip
 * that opens it: its icon, the folder dimmed, the name bright. */
export function MarkdownCode(props: ComponentProps<"code"> & ExtraProps) {
  const text = typeof props.children === "string" ? props.children : ""
  const at = codePath(text)
  const found = useFound(at?.path)
  if (!at || !found) return <Code {...props} />
  const { name, folder } = nameAndFolder(text.trim())
  return (
    <FileLink at={at} found={found} kind="code">
      <Code {...props}>
        <FileIcon aria-hidden />
        {folder && <span data-folder="">{folder}/</span>}
        {name}
      </Code>
    </FileLink>
  )
}

/** A path in plain text (`proseFiles`): underlined once its file is
 * found, else its words. */
export function MarkdownTextPath({ children }: { children?: ReactNode }) {
  const text = typeof children === "string" ? children : ""
  const at = text ? named(text) : undefined
  const found = useFound(at?.path)
  if (!at || !found) return children
  return (
    <FileLink at={at} found={found} kind="text">
      {children}
    </FileLink>
  )
}

/** A Markdown link to a file, as a page's link is drawn, with the file's
 * name where a page shows its host; its words alone with no file there.
 * Either copies as `href`, as it was written. */
export function MarkdownFileLink({
  at,
  href,
  children,
}: {
  at: Named
  href: string
  children: ReactNode
}) {
  const found = useFound(at.path)
  if (!found) return <span data-written={href}>{children}</span>
  return (
    <FileLink at={at} found={found} kind="named" written={href}>
      <span className="underline underline-offset-2">{children}</span>
      <span className="ml-1 text-xs font-normal text-muted-foreground select-none">
        ({nameAndFolder(found.file).name})
      </span>
    </FileLink>
  )
}

/** The file each link drawn here names, for the Thread's menu. */
const LINKED = new WeakMap<Element, FileAt>()

/** A link to a found file. A click opens it in Banda, and with Ctrl or ⌘
 * in its app. */
function FileLink({
  at,
  found,
  kind,
  written,
  children,
}: {
  at: Named
  found: FoundFile
  kind: "code" | "text" | "named"
  /** A named link's href, as written. */
  written?: string
  children: ReactNode
}) {
  const files = useContext(Files)!
  const file: FileAt = { ...found, line: at.line, column: at.column }
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    files.open(file, outsideClick(event))
  }
  return (
    <a
      ref={(link) => {
        if (link) LINKED.set(link, file)
      }}
      href={fileUrl(found.file)}
      data-file={found.file}
      data-kind={kind}
      data-written={written}
      className={
        kind === "named" ? "font-medium wrap-anywhere text-primary" : undefined
      }
      title={linkHint(`${found.file}${lineText(at)}`, "in its app")}
      onClick={open}
      onContextMenu={(event) => {
        // macOS emits contextmenu instead of click for Ctrl+click.
        if (event.ctrlKey) open(event)
      }}
    >
      {children}
    </a>
  )
}

/** The file a link drawn here names, with its line; none for any other
 * element. */
export function fileAtOf(link: Element): FileAt | null {
  return LINKED.get(link) ?? null
}
