/**
 * The extensions' buttons at the end of the browser's row (ADR 0013,
 * decision 6): the pinned ones, and the rest behind one menu, which also
 * pins them, removes them, and opens the Chrome Web Store to add more.
 * A button with a popup opens it under itself (client/desktop/src/popup.ts).
 */
import { useRef, useSyncExternalStore } from "react"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { cn } from "@banda/ui/lib/utils"
import { PinIcon, PinOffIcon, PuzzleIcon, StoreIcon, XIcon } from "lucide-react"
import { type Action, type ActionLook, PARTITION } from "./desktop"
import { actionsNow, browserHost, watchActions } from "./host"

/** Where extensions come from. */
export const WEB_STORE = "https://chromewebstore.google.com/"

export function Extensions({
  tab,
  pinned,
  onStore,
}: {
  /** The shown tab's web contents: the tab the extensions speak of. None
   * while it has no page, or is an Agents', which no extension acts in. */
  tab: number | null
  pinned: readonly string[]
  onStore: () => void
}) {
  const { actions } = useSyncExternalStore(watchActions, actionsNow)
  const menu = useRef<HTMLButtonElement>(null)

  // A button with a popup shows it; one without tells its extension.
  const click = (action: Action, under: HTMLElement | null) => {
    const host = browserHost()
    if (tab === null || !under || !host) return
    const url = popupOf(action, tab)
    if (!url) return void host.actions.click(action.id, tab)
    const { x, y, width, height } = under.getBoundingClientRect()
    host.actions.popup(action.id, url, { x, y, width, height })
  }

  const shown = actions.filter((action) => pinned.includes(action.id))
  return (
    <>
      {shown.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="icon-xs"
          className="relative shrink-0"
          {...labelOf(action, tab)}
          onClick={(event) => click(action, event.currentTarget)}
        >
          <ActionIcon action={action} tab={tab} />
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={menu}
              variant="ghost"
              size="icon-xs"
              aria-label="Extensions"
              title="Extensions"
              className="shrink-0"
            />
          }
        >
          <PuzzleIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {actions.map((action) => {
            const pin = pinned.includes(action.id)
            const { title } = lookOf(action, tab)
            return (
              <DropdownMenuItem
                key={action.id}
                className="group/extension"
                onClick={() => click(action, menu.current)}
              >
                <ActionIcon action={action} tab={tab} />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <Inside
                  label={`${pin ? "Unpin" : "Pin"} ${title}`}
                  className={cn(pin && "opacity-100")}
                  onClick={() => void browserHost()?.pin(action.id, !pin)}
                >
                  {pin ? <PinOffIcon /> : <PinIcon />}
                </Inside>
                <Inside
                  label={`Remove ${title}`}
                  onClick={() => void browserHost()?.remove(action.id)}
                >
                  <XIcon />
                </Inside>
              </DropdownMenuItem>
            )
          })}
          {actions.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onStore}>
            <StoreIcon />
            Chrome Web Store
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/** A button inside a menu's row: it does its own thing, not the row's. */
function Inside({
  label,
  className,
  onClick,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // The menu takes a mouse-up on a row as a click on the row.
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/extension:opacity-100 group-data-[highlighted]/extension:opacity-100 hover:bg-foreground/10 [&_svg]:size-3.5",
        className
      )}
    >
      {children}
    </button>
  )
}

/** The button's look for `tab`: what the extension set for it alone,
 * over what it set for every tab. */
function lookOf(action: Action, tab: number | null): ActionLook {
  const own = tab === null ? undefined : action.tabs[String(tab)]
  return { ...action, ...own }
}

function labelOf(action: Action, tab: number | null) {
  const { title, text } = lookOf(action, tab)
  const label = text ? `${title} (${text})` : title
  return { "aria-label": label, title: label }
}

/** The extension's icon, with its badge. */
function ActionIcon({ action, tab }: { action: Action; tab: number | null }) {
  const { text, color, iconModified } = lookOf(action, tab)
  // An icon of every tab is one URL, which the window keeps; one the
  // extension set for this tab alone names it.
  const own = tab !== null && action.tabs[String(tab)]?.iconModified
  const query = new URLSearchParams({
    tabId: String(own ? tab : -1),
    partition: PARTITION,
  })
  if (iconModified) query.set("t", String(iconModified))
  return (
    <span className="relative flex size-4 shrink-0">
      <img
        src={`crx://extension-icon/${action.id}/32/2?${query}`}
        alt=""
        className="size-4"
      />
      {text && (
        <span
          style={{ background: color }}
          className="absolute -right-1.5 -bottom-1 rounded-sm bg-primary px-0.5 text-[9px] leading-3 font-medium text-white"
        >
          {text}
        </span>
      )}
    </span>
  )
}

/** The popup's page for `tab`; none when the button has no popup. */
function popupOf(action: Action, tab: number): string | null {
  const path = lookOf(action, tab).popup
  return path ? new URL(path, `chrome-extension://${action.id}/`).href : null
}
