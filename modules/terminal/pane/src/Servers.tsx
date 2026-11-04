import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { Server } from "@banda/contract/terminal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { SpaceBadge } from "@banda/ui/components/space-badge"
import type { WidgetProps, WindowApi } from "@banda/ui/module"
import { GlobeIcon, SquareIcon } from "lucide-react"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useState } from "react"
import { arrived, type Placed } from "./arrived"

/**
 * The servers started in Banda, on the bar (ADR 0044, decision 5): the
 * first one's port, and how many more. A click lists every Space's; a row
 * opens its server in a browser Pane in its Space, or with Ctrl or ⌘ in
 * the Person's browser, and its square stops it. It draws nothing while
 * no Space has a server.
 */
export function ServersWidget({ engine, spaces, window }: WidgetProps) {
  const [placed, setPlaced] = useState<Placed[]>([])
  const heard = useCallback(
    (space: SpaceId, servers: readonly Server[]) =>
      setPlaced((before) => arrived(before, space, servers)),
    []
  )
  const listening = spaces.map((space) => (
    <Listen key={space.id} engine={engine} space={space.id} heard={heard} />
  ))
  // The listeners stand first, whatever follows, so none starts again.
  return (
    <>
      {listening}
      {placed.length > 0 && (
        <List placed={placed} spaces={spaces} engine={engine} window={window} />
      )}
    </>
  )
}

function List({
  placed,
  spaces,
  engine,
  window,
}: {
  placed: readonly Placed[]
  spaces: readonly SpaceSummary[]
  engine: Engine
  window: WindowApi
}) {
  const first = placed[0]!
  const words = placed.map(({ server }) => address(server.port)).join(" · ")
  const named = new Map(spaces.map((space) => [space.id, space]))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Servers: ${words}`}
            title={words}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        <span>:{first.server.port}</span>
        {placed.length > 1 && (
          <span className="opacity-70">+{placed.length - 1}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Servers</DropdownMenuLabel>
          {placed.map((each) => (
            <Row
              key={`${each.space}/${each.server.port}`}
              placed={each}
              space={named.get(each.space)}
              engine={engine}
              window={window}
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Row({
  placed: { space, server },
  space: named,
  engine,
  window,
}: {
  placed: Placed
  space: SpaceSummary | undefined
  engine: Engine
  window: WindowApi
}) {
  const url = `http://${address(server.port)}`
  const open = (event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey)
      globalThis.open(url, "_blank", "noopener")
    else window.run("browser.open", { address: url, space })
  }
  // One that ended meanwhile is gone at the next look.
  const stop = () =>
    void engine.call("terminal.stop_server", server, { space }).catch(() => {})
  const by = server.by === "agent" ? "Agent" : "Terminal"
  return (
    <DropdownMenuItem
      className="gap-2 py-1.5"
      title="Opens in a browser Pane; Ctrl-click or ⌘-click opens it in your browser. Delete stops it."
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Delete" || event.key === "Backspace") stop()
      }}
    >
      <GlobeIcon className="text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{address(server.port)}</span>
        <span className="truncate text-xs text-muted-foreground">
          {server.program ? `${by} · ${server.program}` : by}
        </span>
      </span>
      {named && <SpaceBadge space={named} />}
      <button
        type="button"
        aria-label={`Stop ${address(server.port)}`}
        title="Stop server"
        tabIndex={-1}
        className="flex size-6 items-center justify-center rounded-md opacity-0 group-hover/dropdown-menu-item:opacity-100 group-focus/dropdown-menu-item:opacity-100 hover:bg-destructive/10"
        onClick={(event) => {
          // The row opens what its square stops.
          event.stopPropagation()
          stop()
        }}
      >
        {/* A focused menu row sets the colour of everything inside it, the
            square inside the icon too, so fill and stroke name red themselves. */}
        <SquareIcon className="size-2.5 fill-destructive stroke-destructive" />
      </button>
    </DropdownMenuItem>
  )
}

function address(port: number): string {
  return `localhost:${port}`
}

/** Hears `space`'s servers while it is open; a Space that closes, or
 * whose stream ended, has none. */
function Listen({
  engine,
  space,
  heard,
}: {
  engine: Engine
  space: SpaceId
  heard: (space: SpaceId, servers: readonly Server[]) => void
}) {
  useEffect(() => {
    const stop = engine.stream(
      space,
      "terminal.ports",
      {},
      ({ servers }) => heard(space, servers),
      () => heard(space, [])
    )
    return () => {
      stop()
      heard(space, [])
    }
  }, [engine, space, heard])
  return null
}
