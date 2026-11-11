import { useCallback, useLayoutEffect, useRef } from "react"
import {
  ContextMenuContent,
  useAfterMenu,
} from "@banda/ui/components/context-menu"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { type FileAt, fileAtOf } from "@banda/ui/components/markdown-file"
import { webLink } from "@banda/ui/components/markdown-link"
import {
  type Copied,
  copyRich,
  copyText as copy,
} from "@banda/ui/lib/clipboard"
import { lineText } from "@banda/ui/lib/file-links"
import { FIELDS, MOD } from "@banda/ui/lib/keys"
import { rangeMarkdown } from "@banda/ui/lib/markdown-copy"
import { THIS_COMPUTER, useEditors } from "@banda/ui/lib/outside"
import {
  AtSignIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FolderOpenIcon,
  GitForkIcon,
  GlobeIcon,
  ImageIcon,
  PanelRightIcon,
  SquareCodeIcon,
  PencilIcon,
  PlayIcon,
  QuoteIcon,
  SearchIcon,
  SquareDashedIcon,
  TextIcon,
  WrapTextIcon,
} from "lucide-react"

/** What a message offers the menu: its text and what it can do, as its
 * own buttons do. */
export type MessageMenu =
  | {
      kind: "reply"
      text: string
      /** Forks the Thread at the Agent's reply; null while it cannot. */
      fork?: (() => void) | null
    }
  | {
      kind: "message"
      text: string
      /** Asks to edit from the Person's message; null while it cannot. */
      edit?: (() => void) | null
    }

const MENUS = new WeakMap<Element, { current: MessageMenu }>()

/** A ref for a message's element, which a right click in it finds. */
export function useMessageMenu(menu: MessageMenu) {
  const now = useRef(menu)
  useLayoutEffect(() => {
    now.current = menu
  })
  return useCallback((element: HTMLElement | null) => {
    if (element) MENUS.set(element, now)
  }, [])
}

/** What was under the pointer as the menu opened. */
export type MenuAt =
  | {
      kind: "selection"
      text: string
      /** What Copy puts on the clipboard: a reply's Markdown and HTML,
       * read once Copy is chosen. */
      copy: () => Copied
    }
  | { kind: "path"; file: FileAt }
  | { kind: "link"; address: string }
  | {
      kind: "code"
      /** The block's own buttons, which the menu presses. */
      copy: HTMLElement
      wrap: HTMLElement
      run: HTMLElement | null
    }
  | {
      kind: "image"
      /** The button that shows it large; none on an image without. */
      preview: HTMLElement | null
      x: number
      y: number
    }
  | { kind: "message"; menu: MessageMenu; element: HTMLElement }

/**
 * What a right click at `target` in the Thread shows; none where it has
 * nothing to offer (ADR 0063, decision 3). The first that is there wins:
 * the text selected in the Thread, a path, a web link, an image, a code
 * block, a message.
 */
export function menuAt(
  target: Element,
  thread: Element,
  point: { x: number; y: number }
): MenuAt | null {
  // A field keeps the system's own.
  if (target.closest(FIELDS)) return null
  const selection = target.ownerDocument.getSelection()
  const text = selection?.isCollapsed ? "" : (selection?.toString() ?? "")
  if (text.trim() && thread.contains(selection!.anchorNode)) {
    const range = selection!.getRangeAt(0).cloneRange()
    return {
      kind: "selection",
      text,
      copy: () => rangeMarkdown(range, thread) ?? { text },
    }
  }
  const path = target.closest("a[data-file]")
  const file = path && fileAtOf(path)
  if (file) return { kind: "path", file }
  const link = target.closest<HTMLAnchorElement>("a[href]")
  if (link && webLink(link.getAttribute("href") ?? undefined))
    return { kind: "link", address: link.href }
  const image = target.closest("img")
  if (image)
    return { kind: "image", preview: image.closest("button"), ...point }
  const block = target.closest("[data-streamdown=code-block]")
  if (block) {
    const act = (name: string) =>
      block.querySelector<HTMLElement>(`[data-act=${name}]`)
    const [copy, wrap] = [act("copy"), act("wrap")]
    if (copy && wrap) return { kind: "code", copy, wrap, run: act("run") }
  }
  for (
    let at: Element | null = target;
    at && at !== thread;
    at = at.parentElement
  ) {
    const menu = MENUS.get(at)?.current
    if (menu) return { kind: "message", menu, element: at as HTMLElement }
  }
  return null
}

/** What the Thread does for its menu. */
export type ThreadActs = {
  quote: (text: string) => void
  find: (words: string) => void
  /** Searches the web in Banda's browser; none where no window does. */
  search?: (words: string) => void
  open: (address: string, outside: boolean) => void
  /** Whether an address opens in Banda's browser: another machine's
   * Project has none yet. */
  inBanda: (address: string) => boolean
  /** Whether it opens from this device at all, which an address of that
   * machine's own does not. */
  opensHere: (address: string) => boolean
  /** Opens a file a path names, in Banda, in Quick Look over the desk, in
   * the app the system has for it, or in an editor at its line; shows it
   * in its folder; none where no window looks at files. Only a file this
   * computer holds has an app, an editor or a folder here (`onDevice`). */
  file?: {
    open: (at: FileAt, outside: boolean) => void
    peek: (at: FileAt) => void
    system: (at: FileAt) => void
    edit: (at: FileAt) => void
    show: (at: FileAt) => void
    onDevice: (at: FileAt) => boolean
  }
  /** Names the file at the whole `path` in the message, as `@` does. */
  attach: (path: string) => void
  /** Copies the image at a point of the page; none where no window does. */
  copyImage?: (x: number, y: number) => void
}

/** The Thread's menu, for what {@link menuAt} found. */
export function ThreadMenu({
  at,
  acts,
}: {
  at: MenuAt | null
  acts: ThreadActs
}) {
  return (
    <ContextMenuContent aria-label="Thread" className="min-w-56">
      {at && <Items at={at} acts={acts} />}
    </ContextMenuContent>
  )
}

function Items({ at, acts }: { at: MenuAt; acts: ThreadActs }) {
  // Each act waits for the menu to go: it gives the focus back as it goes,
  // which would undo a quote's, or clear a selection made.
  const later = useAfterMenu()
  // Ctrl or ⌘ with a click opens a path in it, when there is one.
  const { editor } = useEditors()
  const item = (act: () => void) => () => later(act)
  switch (at.kind) {
    case "selection": {
      const words = at.text.trim().replace(/\s+/g, " ")
      // A phrase is looked for; a whole passage is only copied or quoted.
      const phrase = words.length <= PHRASE
      return (
        <>
          <DropdownMenuItem onClick={() => copyRich(at.copy())}>
            <CopyIcon />
            Copy
            <DropdownMenuShortcut>{MOD}C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={item(() => acts.quote(at.text))}>
            <QuoteIcon />
            Quote in reply
          </DropdownMenuItem>
          {phrase && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={item(() => acts.find(words))}>
                <SearchIcon />
                Find “{shortened(words)}” in Thread
              </DropdownMenuItem>
              {acts.search && (
                <DropdownMenuItem onClick={item(() => acts.search!(words))}>
                  <GlobeIcon />
                  Search the web
                </DropdownMenuItem>
              )}
            </>
          )}
        </>
      )
    }
    case "path": {
      const { file } = at
      const line = lineText(file)
      return (
        <>
          {acts.file && (
            <>
              <DropdownMenuItem
                onClick={item(() => acts.file!.open(file, false))}
              >
                <PanelRightIcon />
                Open in Banda
              </DropdownMenuItem>
              <DropdownMenuItem onClick={item(() => acts.file!.peek(file))}>
                <EyeIcon />
                Quick Look
              </DropdownMenuItem>
              {acts.file.onDevice(file) && (
                <>
                  <DropdownMenuItem
                    onClick={item(() => acts.file!.system(file))}
                  >
                    <ExternalLinkIcon />
                    Open in its app
                    {!editor && (
                      <DropdownMenuShortcut>{MOD}click</DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                  {editor && (
                    <DropdownMenuItem
                      onClick={item(() => acts.file!.edit(file))}
                    >
                      <SquareCodeIcon />
                      Open in {editor.name}
                      <DropdownMenuShortcut>{MOD}click</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={item(() => acts.file!.show(file))}>
                    <FolderOpenIcon />
                    Show in folder
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => copy(file.file)}>
            <CopyIcon />
            Copy full path
          </DropdownMenuItem>
          {file.relative !== file.file && (
            <DropdownMenuItem onClick={() => copy(`${file.relative}${line}`)}>
              <CopyIcon />
              Copy relative path
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={item(() => acts.attach(file.file))}>
            <AtSignIcon />
            Add to message
          </DropdownMenuItem>
        </>
      )
    }
    case "link": {
      const inBanda = acts.inBanda(at.address)
      const outside = acts.opensHere(at.address)
      return (
        <>
          {inBanda && (
            <DropdownMenuItem
              onClick={item(() => acts.open(at.address, false))}
            >
              <PanelRightIcon />
              Open in Banda
            </DropdownMenuItem>
          )}
          {outside && (
            <DropdownMenuItem onClick={item(() => acts.open(at.address, true))}>
              <ExternalLinkIcon />
              {inBanda
                ? "Open in external browser"
                : `Open in ${THIS_COMPUTER}'s browser`}
              {inBanda && (
                <DropdownMenuShortcut>{MOD}click</DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          )}
          {(inBanda || outside) && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => copy(at.address)}>
            <CopyIcon />
            Copy address
          </DropdownMenuItem>
        </>
      )
    }
    case "image": {
      const { preview } = at
      return (
        <>
          {preview && (
            <DropdownMenuItem onClick={item(() => preview.click())}>
              <ImageIcon />
              Open
            </DropdownMenuItem>
          )}
          {acts.copyImage && (
            <DropdownMenuItem onClick={() => acts.copyImage!(at.x, at.y)}>
              <CopyIcon />
              Copy image
            </DropdownMenuItem>
          )}
        </>
      )
    }
    case "code": {
      const { copy, wrap, run } = at
      return (
        <>
          <DropdownMenuItem onClick={() => copy.click()}>
            <CopyIcon />
            Copy code
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            closeOnClick
            checked={wrap.getAttribute("aria-pressed") === "true"}
            onCheckedChange={() => wrap.click()}
          >
            <WrapTextIcon />
            Wrap lines
          </DropdownMenuCheckboxItem>
          {run && (
            <DropdownMenuItem onClick={item(() => run.click())}>
              <PlayIcon />
              Run in terminal
            </DropdownMenuItem>
          )}
        </>
      )
    }
    case "message": {
      const { menu, element } = at
      if (menu.kind === "message")
        return (
          <>
            <DropdownMenuItem onClick={() => copy(menu.text)}>
              <CopyIcon />
              Copy message
            </DropdownMenuItem>
            {menu.edit !== undefined && (
              <DropdownMenuItem
                disabled={menu.edit === null}
                onClick={menu.edit ? item(menu.edit) : undefined}
              >
                <PencilIcon />
                Edit from here
              </DropdownMenuItem>
            )}
          </>
        )
      return (
        <>
          <DropdownMenuItem onClick={() => copy(menu.text)}>
            <CopyIcon />
            Copy reply
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(element.innerText)}>
            <TextIcon />
            Copy as plain text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={item(() => acts.quote(element.innerText))}>
            <QuoteIcon />
            Quote reply
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {menu.fork !== undefined && (
            <DropdownMenuItem
              disabled={menu.fork === null}
              onClick={menu.fork ? item(menu.fork) : undefined}
            >
              <GitForkIcon />
              Fork from this response
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={item(() => selectAll(element))}>
            <SquareDashedIcon />
            Select reply
          </DropdownMenuItem>
        </>
      )
    }
  }
}

/** The longest selection the menu looks for, in Thread or on the web. */
const PHRASE = 120

/** `words` short enough for a menu's line. */
function shortened(words: string): string {
  return words.length > 24 ? `${words.slice(0, 23).trimEnd()}…` : words
}

function selectAll(element: HTMLElement): void {
  // A field with the focus, as the composer, would take the selection back.
  const focused = element.ownerDocument.activeElement
  if (focused instanceof HTMLElement) focused.blur()
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  const selection = element.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
