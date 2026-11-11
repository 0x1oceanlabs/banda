import {
  createContext,
  useContext,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react"
import { linkPath } from "../lib/file-links"
import { linkHint, outsideClick } from "../lib/links"
import { MarkdownFileLink } from "./markdown-file"

/** The host supplies navigation; Markdown knows neither modules nor Electron. */
type OpenLink = (url: string, external: boolean) => void
const Opener = createContext<OpenLink | null>(null)

/** What a link says under the pointer, where a host opens it its own way. */
type LinkTitle = (url: string) => string
const Titled = createContext<LinkTitle>(linkHint)

export function MarkdownLinks({
  open,
  hint = linkHint,
  children,
}: {
  open: OpenLink
  hint?: LinkTitle
  children: ReactNode
}) {
  return (
    <Opener value={open}>
      <Titled value={hint}>{children}</Titled>
    </Opener>
  )
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

/** What marks a note's citation and its way back. */
type NoteMarks = {
  "data-footnote-ref"?: boolean
  "data-footnote-backref"?: boolean
}

export function MarkdownLink({
  href,
  children,
  title,
  id,
  "data-footnote-ref": note,
  "data-footnote-backref": back,
}: ComponentProps<"a"> & NoteMarks) {
  const open = useContext(Opener)
  const hint = useContext(Titled)
  if (href?.startsWith("#"))
    return (
      <PlaceLink
        href={href}
        id={id}
        data-footnote-ref={note}
        data-footnote-backref={back}
      >
        {children}
      </PlaceLink>
    )
  const url = webLink(href)
  const file = !url && href ? linkPath(href) : null
  if (file)
    return (
      <MarkdownFileLink at={file} href={href!}>
        {children}
      </MarkdownFileLink>
    )
  const bare = typeof children === "string" && children === href
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!open || !url || !href) return
    event.preventDefault()
    open(href, outsideClick(event))
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-streamdown="link"
      className="font-medium wrap-anywhere text-primary"
      title={url && open && href ? hint(href) : title}
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
        <span className="ml-1 text-xs font-normal text-muted-foreground select-none">
          ({url.host})
        </span>
      )}
    </a>
  )
}

/**
 * A link to a place in its own reply, as a footnote's citation and its way
 * back (ADR 0063, decision 1), which keep their marks for Copy. It scrolls the Thread there and lights the
 * place once; it never opens a window, nor scrolls what holds the Thread.
 * A citation tells its note when hovered or focused.
 */
function PlaceLink({
  href,
  id,
  children,
  ...marks
}: NoteMarks & {
  href: string
  id?: string
  children: ReactNode
}) {
  return (
    <a
      {...marks}
      href={href}
      id={id}
      data-place=""
      className="font-medium text-primary"
      onPointerEnter={tell}
      onFocus={tell}
      onClick={go}
    >
      {children}
    </a>
  )
}

/** Each reply's ids are its own (`Markdown`), so the place is the
 * document's one of that id. */
const placeOf = (link: HTMLAnchorElement) =>
  link.ownerDocument.getElementById(link.getAttribute("href")!.slice(1))

/** A citation's title is its note's words, without the way back. */
function tell({ currentTarget: link }: { currentTarget: HTMLAnchorElement }) {
  if (link.title || link.closest("section[data-footnotes]")) return
  const note = placeOf(link)?.cloneNode(true) as HTMLElement | undefined
  if (!note) return
  for (const back of note.querySelectorAll("a[data-place]")) back.remove()
  link.title = (note.textContent ?? "").replace(/\s+/g, " ").trim()
}

const still =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : undefined
const LIT = {
  backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)",
  color: "var(--foreground)",
}

/** Scrolls the Thread so the place is in its middle, and lights it once. */
function go(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
  const place = placeOf(event.currentTarget)
  if (!place) return
  place.scrollIntoView({
    block: "center",
    // Chromium's: only the Thread scrolls, never the Strip around it.
    container: "nearest",
    behavior: still?.matches ? "auto" : "smooth",
  } as ScrollIntoViewOptions)
  place.animate([LIT, { ...LIT, offset: 0.4 }, {}], {
    duration: 1200,
    easing: "ease-out",
  })
}
