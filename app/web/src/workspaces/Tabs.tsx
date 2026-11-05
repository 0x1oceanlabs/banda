import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import type { Chime } from "@banda/ui/sound"
import { labelOf, useSaid } from "../registry"
import type { Entry } from "./model"
import { AgentMark, type Frame } from "./PaneFrame"

/**
 * A Deck's bar of names, over its tile as Hyprland's groupbar (ADR
 * 0005, decision 6): one segment per Pane, all as wide, the shown one
 * filled. The tile under it keeps its own header. A segment whose Thread
 * calls the Person carries its mark, so no call hides behind another tab.
 * A click shows the Pane; a middle click closes it; a segment dragged
 * carries its Pane (`data-handle`).
 */
export function Tabs({
  entries,
  active,
  focused,
  called,
  marked,
  frame,
}: {
  entries: readonly Entry[]
  active: number
  /** The column has the focus: its shown segment takes the focus color. */
  focused: boolean
  called: (entry: Entry) => Chime | undefined
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  frame: Frame
}) {
  const said = useSaid()
  return (
    <div
      role="tablist"
      data-handle=""
      data-focused={focused}
      className="group/tabs flex h-6 shrink-0 gap-1 text-xs"
    >
      {entries.map((entry, e) => {
        const { title } = labelOf(entry.pane, said.get(entry.id))
        const call = called(entry)
        const shown = e === active
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={shown}
            data-pane={entry.id}
            title={call ? `${title} · ${MARK_WORDS[call]}` : title}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-tile border-(length:--tile-border) border-focus-inactive bg-tile px-2 text-muted-foreground outline-none hover:text-foreground focus-visible:underline aria-selected:border-transparent aria-selected:bg-muted-foreground aria-selected:text-background group-data-[focused=true]/tabs:aria-selected:bg-focus group-data-[focused=true]/tabs:aria-selected:text-primary-foreground"
            // The focus stays in the tile, as a groupbar takes none.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => frame.focus(entry.id)}
            onAuxClick={(event) => {
              if (event.button === 1) frame.close(entry.id)
            }}
          >
            {call && (
              <BandaMark
                variant="agent"
                state={call}
                playful={0}
                className="size-3.5 shrink-0"
              />
            )}
            <span className="min-w-0 truncate">{title}</span>
            {marked(entry) && <AgentMark />}
          </button>
        )
      })}
    </div>
  )
}
