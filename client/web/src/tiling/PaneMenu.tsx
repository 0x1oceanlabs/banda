import { type ComponentType, useState } from "react"
import { createPortal } from "react-dom"
import type { Args } from "@banda/ui/module"
import { useAfterMenu } from "@banda/ui/components/context-menu"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@banda/ui/components/dropdown-menu"
import { cn } from "@banda/ui/lib/utils"
import {
  AppWindowIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  MoveHorizontalIcon,
  PanelTopIcon,
  PlusIcon,
  ScanIcon,
  SquareArrowDownLeftIcon,
  XIcon,
} from "lucide-react"
import { drawn, share, type Width } from "./model"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"

/** Where a Pane stands on its workspace, as its menu shows it. */
export type Stand = {
  /** Its column's share of the room, as drawn. */
  width: number
  /** Its column is the whole screen wide over its width (`Alt+F`). */
  full: boolean
  /** Its column is a Deck: one of its Panes at a time (ADR 0065). */
  deck: boolean
  /** How many Panes its column holds, and its share of the column's
   * height. */
  panes: number
  height: number
  /** A column stands on its left, on its right. */
  left: boolean
  right: boolean
  /** Its workspace's number, from 1, of how many there are: the empty
   * one at the bottom is the last. */
  workspace: number
  workspaces: number
  /** It is in a window of its own (ADR 0025, decision 9). */
  away: boolean
  /** The look's steps: `[columns] presets` and `heights`. */
  presets: readonly Width[]
  heights: readonly Width[]
  /** The share its column is never drawn narrower than, by its `min`. */
  floor: number
  /** What its Item's item actions offer here, as Later… or Wake now for
   * a Thread (ADR 0087, decision 12): each row, and what runs it. */
  items: readonly StandRow[]
}

/** A row of an item action the Pane menu offers, and its id and args. */
export type StandRow = {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  args: Args
}

/** What the menu asks of the window. */
export type MenuFrame = {
  /** Runs an action by its id for this Pane, as its key would. */
  run: (action: string, args?: Args) => void
  /** Opens it in a window of its own, or brings it back; none where a
   * Pane cannot pop out. */
  popOut?: boolean
}

/** How a step reads under its picture. */
const WORDS: Record<string, string> = {
  "1/4": "¼",
  "1/3": "⅓",
  "1/2": "½",
  "2/3": "⅔",
  "3/4": "¾",
  "1": "Full",
}
const wordsOf = (step: Width) => WORDS[step] ?? step

const near = (a: number, b: number | undefined) =>
  b !== undefined && Math.abs(a - b) < 0.01

/** Where the column of Pane `entry` would end at `at` of the room, on
 * screen; none when it stands on no Strip. */
function reach(entry: string, at: number): DOMRect | undefined {
  const tile = document.querySelector(`[data-tile="${CSS.escape(entry)}"]`)
  const column = tile?.closest<HTMLElement>("[data-column]")
  const strip = column?.parentElement
  if (!column || !strip) return undefined
  const style = getComputedStyle(strip)
  const gap = parseFloat(style.columnGap) || 0
  const room =
    strip.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight)
  const box = column.getBoundingClientRect()
  return new DOMRect(box.left, box.top, at * (room + gap) - gap, box.height)
}

/**
 * The Pane menu (ADR 0066, decision 3): the look's widths and heights as
 * pictures, then what the keys do to a Pane and its column, each with its
 * key. Its button at the header's end and a right click on the header
 * open it; a row runs the action its key runs.
 */
export function PaneMenu({
  entry,
  stand,
  frame,
  zoomed,
}: {
  /** The Pane's place in the workspaces. */
  entry: string
  stand: Stand
  frame: MenuFrame
  /** It is over the whole window now (`Alt+Shift+F`). */
  zoomed: boolean
}) {
  // A right click's menu gives the focus back first, then the row acts.
  const later = useAfterMenu()
  const run = (action: string, args?: Args) =>
    later(() => frame.run(action, args))
  const keyOf = useKeyLabel()
  // Where the column would end, while a width is pointed at.
  const [reaches, setReaches] = useState<DOMRect>()
  const alone = stand.panes === 1
  const stacked = stand.panes > 1 && !stand.deck
  const own = stand.workspaces - 1
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="flex justify-between">
          Width<span>{keyOf("column.next-width")}</span>
        </DropdownMenuLabel>
        <Steps
          steps={stand.presets}
          // As Alt+R steps: by the width each is drawn at, so of the
          // presets the column's min draws alike, the widest stands.
          shows={(at) => drawn(at, stand.floor)}
          on={(at) => near(at, drawn(stand.width, stand.floor))}
          picture="width"
          choose={(width) => run("column.width", { width })}
          point={(at) =>
            setReaches(at === undefined ? undefined : reach(entry, at))
          }
        />
      </DropdownMenuGroup>
      {stacked && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex justify-between">
            Height in its column<span>{keyOf("pane.next-height")}</span>
          </DropdownMenuLabel>
          <Steps
            steps={stand.heights}
            on={(at) => near(at, stand.height)}
            picture="height"
            choose={(height) => run("pane.height", { height })}
          />
        </DropdownMenuGroup>
      )}
      <DropdownMenuSeparator />
      <Row
        icon={stand.full ? Minimize2Icon : MoveHorizontalIcon}
        words={stand.full ? "Back to its width" : "Full width"}
        keys={keyOf("column.maximize")}
        act={() => run("column.maximize")}
      />
      <Row
        icon={zoomed ? Minimize2Icon : Maximize2Icon}
        words={zoomed ? "Out of the zoom" : "Zoom"}
        keys={keyOf("pane.zoom")}
        act={() => run("pane.zoom")}
      />
      <Row
        icon={ScanIcon}
        words="Center the column"
        keys={keyOf("column.center")}
        act={() => run("column.center")}
      />
      <Row
        icon={PanelTopIcon}
        words={stand.deck ? "Column as a stack" : "Column as a deck"}
        keys={keyOf("column.tabs")}
        act={() => run("column.tabs")}
      />
      <DropdownMenuSeparator />
      <Row
        icon={ArrowLeftToLineIcon}
        words={alone ? "Into the left column" : "Out to the left"}
        keys={keyOf("pane.consume-left")}
        disabled={alone && !stand.left}
        act={() => run("pane.consume-left")}
      />
      <Row
        icon={ArrowRightToLineIcon}
        words={alone ? "Into the right column" : "Out to the right"}
        keys={keyOf("pane.consume-right")}
        disabled={alone && !stand.right}
        act={() => run("pane.consume-right")}
      />
      {own > 0 && stand.workspaces <= 9 && (
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-sm">
          <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1">To workspace</span>
          {Array.from({ length: stand.workspaces }, (_, i) => i + 1).map(
            (n) => (
              <DropdownMenuItem
                key={n}
                disabled={n === stand.workspace}
                aria-label={
                  n === stand.workspaces
                    ? "To a new workspace"
                    : `To workspace ${n}`
                }
                title={keyOf(`pane.send-${n}`)}
                className="min-w-6 justify-center px-1.5 tabular-nums"
                onClick={() => run(`pane.send-${n}`)}
              >
                {n === stand.workspaces ? <PlusIcon /> : n}
              </DropdownMenuItem>
            )
          )}
        </div>
      )}
      {frame.popOut && (
        <Row
          icon={stand.away ? SquareArrowDownLeftIcon : AppWindowIcon}
          words={stand.away ? "Back in its place" : "In its own window"}
          keys={keyOf("pane.pop-out")}
          act={() => run("pane.pop-out")}
        />
      )}
      {stand.items.length > 0 && <DropdownMenuSeparator />}
      {stand.items.map((item) => (
        <Row
          key={item.id}
          icon={item.icon}
          words={item.title}
          keys={keyOf(item.id)}
          act={() => run(item.id, item.args)}
        />
      ))}
      <DropdownMenuSeparator />
      <Row
        icon={XIcon}
        words="Close"
        keys={keyOf("pane.close")}
        act={() => run("pane.close")}
      />
      {reaches &&
        createPortal(
          <div
            aria-hidden
            style={{
              left: reaches.left,
              top: reaches.top,
              width: reaches.width,
              height: reaches.height,
            }}
            className="pointer-events-none fixed z-40 rounded-tile border-2 border-dashed border-focus bg-focus/10 transition-[width] duration-150"
          />,
          document.body
        )}
    </>
  )
}

/** A row of steps, each a picture of its share and its words. */
function Steps({
  steps,
  shows = (at) => at,
  on,
  picture,
  choose,
  point,
}: {
  steps: readonly Width[]
  /** The share a step is drawn at; its own, by default. */
  shows?: (at: number) => number
  on: (at: number) => boolean
  picture: "width" | "height"
  choose: (step: Width) => void
  /** Told the share pointed at, and none once the pointer leaves. */
  point?: (at: number | undefined) => void
}) {
  return (
    <div className="flex gap-0.5 px-0.5 pb-1">
      {steps.map((step) => {
        const at = share(step)
        if (at === undefined) return null
        const seen = shows(at)
        // A wider step drawn alike stands for this one.
        const passed = steps.some((other) => {
          const there = share(other)
          return there !== undefined && there > at && near(shows(there), seen)
        })
        const lit = !passed && on(seen)
        return (
          <DropdownMenuItem
            key={step}
            aria-label={`${picture === "width" ? "Width" : "Height"} ${step}`}
            data-on={lit || undefined}
            className="flex-1 flex-col gap-1 rounded-md border border-transparent py-1.5 text-xs text-muted-foreground data-on:border-border data-on:bg-muted data-on:text-foreground"
            onClick={() => choose(step)}
            disabled={passed}
            onPointerEnter={point && (() => point(seen))}
            onPointerLeave={point && (() => point(undefined))}
            onFocus={point && (() => point(seen))}
            onBlur={point && (() => point(undefined))}
          >
            <span
              className={cn(
                "flex rounded-[3px] border-[1.5px] border-muted-foreground/50 p-0.5",
                picture === "width" ? "h-5 w-9" : "h-7 w-6 flex-col",
                lit && "border-foreground/70"
              )}
            >
              <span
                className={cn(
                  "rounded-[1px] bg-muted-foreground/60",
                  lit && "bg-focus"
                )}
                style={
                  picture === "width"
                    ? { width: `${at * 100}%` }
                    : { height: `${at * 100}%` }
                }
              />
            </span>
            {wordsOf(step)}
          </DropdownMenuItem>
        )
      })}
    </div>
  )
}

/** One row: its icon, its words, its key. */
function Row({
  icon: Icon,
  words,
  keys,
  disabled,
  act,
}: {
  icon: ComponentType<{ className?: string }>
  words: string
  keys?: string
  disabled?: boolean
  act: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onClick={act}>
      <Icon className="text-muted-foreground" />
      {words}
      {keys && (
        <DropdownMenuShortcut className="tracking-normal">
          {keys}
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  )
}
