import {
  createContext,
  useContext,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react"

/** The host supplies navigation; Markdown knows neither modules nor Electron. */
type OpenLink = (url: string, external: boolean) => void
const Opener = createContext<OpenLink | null>(null)

export function MarkdownLinks({
  open,
  children,
}: {
  open: OpenLink
  children: ReactNode
}) {
  return <Opener value={open}>{children}</Opener>
}

/** Only absolute HTTP(S) destinations participate in Thread navigation. */
export function webLink(href: string | undefined): URL | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href)
  } catch {
    return null
  }
}

export function MarkdownLink({ href, children, title }: ComponentProps<"a">) {
  const open = useContext(Opener)
  const url = webLink(href)
  const bare = typeof children === "string" && children === href
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!open || !url || !href) return
    event.preventDefault()
    open(href, event.ctrlKey)
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-streamdown="link"
      className="font-medium wrap-anywhere text-primary"
      title={
        url && open
          ? `${href}\nClick to open in Banda · Ctrl+click to open in external browser`
          : title
      }
      onClick={follow}
      onContextMenu={(event) => {
        // macOS emits contextmenu instead of click for Ctrl+click.
        if (event.ctrlKey) follow(event)
      }}
    >
      <span
        className={
          bare && url
            ? "inline-block max-w-[min(100%,32rem)] truncate align-bottom underline underline-offset-2"
            : "underline underline-offset-2"
        }
      >
        {children}
      </span>
      {url && !bare && (
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          ({url.host})
        </span>
      )}
    </a>
  )
}
