import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import type { Engine, SpaceSummary } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@bandaso/ui/components/resizable"
import type { PaneState, Place } from "@bandaso/ui/pane"
import { paneOf } from "@bandaso/ui/pane"
import { Columns2Icon, Rows2Icon, XIcon } from "lucide-react"
import { keyAction, toProgram } from "./keys"
import {
  close,
  EMPTY,
  focus,
  focused,
  type Layout,
  left,
  move,
  type Node,
  open,
  parse,
  resize,
  show,
  split,
  type Tile,
  tiles,
} from "./layout"
import { Choices, kindOf, launcher, runs, startable } from "./registry"

/** A tile split from a narrow one takes this share of the room. */
const BESIDE_NARROW = 72

type Change = (layout: Layout) => Layout

/** The tiles of one Space. The layout is kept per Space on this computer. */
export function Desk({
  engine,
  space,
  modules,
}: {
  engine: Engine
  space: SpaceSummary
  modules: readonly string[]
}) {
  const [layout, setLayout] = useState(() => load(space.id, modules))
  useEffect(() => keep(space.id, layout), [space.id, layout])
  // A Pane that leaves lets its module let go, as a terminal stops its
  // program; one that a split draws again has not left.
  const shown = useRef(layout)
  useEffect(() => {
    for (const pane of left(shown.current, layout)) {
      kindOf(pane.kind)?.closed?.({ engine, space: space.id, args: pane.args })
    }
    shown.current = layout
  }, [engine, space.id, layout])
  const change = useCallback((how: Change) => setLayout(how), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(event, toProgram(event.target))
      if (!action) return
      event.preventDefault()
      setLayout((layout) => {
        const tile = focused(layout)
        switch (action.do) {
          case "move":
            return move(layout, action.direction)
          case "split":
            return splitting(layout, tile?.id, action.place)
          case "close":
            return tile ? close(layout, tile.id) : layout
        }
      })
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [])

  if (!layout.root) {
    return (
      <Welcome
        modules={modules}
        onOpen={(pane) => change((l) => open(l, pane))}
      />
    )
  }
  const current = focused(layout)?.id
  return (
    <div className="h-full min-h-0 p-1">
      <NodeView
        node={layout.root}
        engine={engine}
        space={space}
        modules={modules}
        current={current}
        change={change}
      />
    </div>
  )
}

/** The share a new tile takes beside a narrow Pane: most of the room. */
function shareBeside(
  layout: Layout,
  from: string | undefined,
  place: Place | undefined
): number | undefined {
  const opener = tiles(layout).find((tile) => tile.id === from)
  const narrow = opener && kindOf(opener.pane.kind)?.narrow
  return narrow && place !== "below" ? BESIDE_NARROW : undefined
}

/** Opens a Pane a tile asked for. */
function opening(
  layout: Layout,
  pane: PaneState,
  from: string | undefined,
  place: Place | undefined
): Layout {
  return open(layout, pane, {
    from,
    place,
    share: shareBeside(layout, from, place),
  })
}

/** Splits a tile, and lets the Person pick what the new one shows. */
function splitting(
  layout: Layout,
  from: string | undefined,
  place: "right" | "below"
): Layout {
  const share = shareBeside(layout, from, place)
  return split(layout, paneOf(launcher, {}), { from, place, share })
}

type NodeProps = {
  engine: Engine
  space: SpaceSummary
  modules: readonly string[]
  current: string | undefined
  change: (how: Change) => void
}

function NodeView({ node, ...props }: NodeProps & { node: Node }) {
  if (node.type === "tile") return <TileView tile={node} {...props} />
  const ids = node.children.map((child) => child.id)
  return (
    <ResizablePanelGroup
      // A new set of children starts from the shares the layout keeps.
      key={ids.join(" ")}
      orientation={node.axis === "row" ? "horizontal" : "vertical"}
      defaultLayout={Object.fromEntries(
        ids.map((id, i) => [id, node.sizes[i]])
      )}
      onLayoutChanged={(sizes, meta) => {
        if (!meta.isUserInteraction) return
        props.change((l) =>
          resize(
            l,
            node.id,
            ids.map((id) => sizes[id] ?? 0)
          )
        )
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle className="bg-transparent" />}
          <ResizablePanel id={child.id} minSize="10%">
            <NodeView node={child} {...props} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

function TileView({
  tile,
  engine,
  space,
  modules,
  current,
  change,
}: NodeProps & { tile: Tile }) {
  const kind = kindOf(tile.pane.kind)
  const shown = kind && runs(kind, modules) ? kind : undefined
  const isFocused = current === tile.id
  const frame = useRef<HTMLElement>(null)
  const title = kind ? kind.title(tile.pane.args) : "Unknown Pane"
  const Icon = kind?.icon

  useEffect(() => {
    const element = frame.current
    if (isFocused && element && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true })
    }
  }, [isFocused])

  const take = () => change((l) => focus(l, tile.id))
  return (
    <section
      ref={frame}
      tabIndex={-1}
      aria-label={title}
      data-focused={isFocused}
      onPointerDownCapture={take}
      onFocusCapture={take}
      className="group/tile flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background outline-none data-[focused=true]:border-ring/60"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-sm">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="min-w-0 truncate font-medium text-muted-foreground group-data-[focused=true]/tile:text-foreground">
          {title}
        </h2>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[focused=true]/tile:opacity-100 focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Split right"
            title="Split right (Ctrl+\)"
            onClick={() => change((l) => splitting(l, tile.id, "right"))}
          >
            <Columns2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Split down"
            title="Split down (Ctrl+Shift+\)"
            onClick={() => change((l) => splitting(l, tile.id, "below"))}
          >
            <Rows2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Close ${title}`}
            title="Close (Ctrl+W)"
            onClick={() => change((l) => close(l, tile.id))}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {shown ? (
          <shown.Pane
            engine={engine}
            space={space.id}
            args={tile.pane.args}
            focused={isFocused}
            open={(pane, place) =>
              change((l) => opening(l, pane, tile.id, place))
            }
            update={(args) =>
              change((l) => show(l, tile.id, { kind: tile.pane.kind, args }))
            }
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {kind
              ? "This Pane comes back when the engine runs its module."
              : "This window does not know this kind of Pane."}
          </p>
        )}
      </div>
    </section>
  )
}

function Welcome({
  modules,
  onOpen,
}: {
  modules: readonly string[]
  onOpen: (pane: PaneState) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        This Desk is empty. Open a Pane:
      </p>
      <Choices modules={modules} onPick={onOpen} />
    </div>
  )
}

const KEY = "bandaso.desk."

/** The layout kept for a Space, or a first one: the first Pane to start. */
function load(space: string, modules: readonly string[]): Layout {
  try {
    const kept = parse(JSON.parse(localStorage.getItem(KEY + space) ?? "null"))
    if (kept) return kept
  } catch {
    // A broken or missing layout starts over.
  }
  const first = startable(modules)[0]
  return first ? open(EMPTY, first) : EMPTY
}

function keep(space: string, layout: Layout): void {
  try {
    localStorage.setItem(KEY + space, JSON.stringify(layout))
  } catch {
    // The layout is a convenience; the work is in the engine.
  }
}
