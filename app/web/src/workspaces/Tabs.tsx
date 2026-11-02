import { XIcon } from "lucide-react"
import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import type { Chime } from "@banda/ui/sound"
import { labelOf } from "../registry"
import type { Entry } from "./model"
import { AgentMark, type Frame } from "./PaneFrame"

/**
 * A tabbed column's row of tabs, in place of its tile's header (ADR 0005,
 * decision 6): one per Pane, the shown one raised. A tab whose Thread
 * calls the Person carries its mark, so no call hides behind another tab.
 * A click shows the Pane; a middle click, or its cross, closes it; a tab
 * dragged carries its Pane (`data-handle`).
 */
export function Tabs({
  entries,
  active,
  called,
  marked,
  frame,
}: {
  entries: readonly Entry[]
  active: number
  called: (entry: Entry) => Chime | undefined
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  frame: Frame
}) {
  return (
    <div
      role="tablist"
      data-handle=""
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b text-sm [scrollbar-width:none]"
    >
      {entries.map((entry, e) => {
        const { title, Icon } = labelOf(entry.pane)
        const call = called(entry)
        const shown = e === active
        return (
          <div
            key={entry.id}
            data-pane={entry.id}
            data-shown={shown}
            className="group/tab flex max-w-60 min-w-24 flex-1 items-center gap-1.5 border-r bg-muted/50 pr-1 pl-2.5 text-muted-foreground last:border-r-0 hover:bg-muted data-[shown=true]:bg-background data-[shown=true]:text-foreground"
          >
            <button
              type="button"
              role="tab"
              aria-selected={shown}
              title={call ? `${title} · ${MARK_WORDS[call]}` : title}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 outline-none focus-visible:underline"
              onClick={() => frame.focus(entry.id)}
              onAuxClick={(event) => {
                if (event.button === 1) frame.close(entry.id)
              }}
            >
              {call ? (
                <BandaMark
                  variant="agent"
                  state={call}
                  playful={0}
                  className="size-4 shrink-0"
                />
              ) : (
                Icon && <Icon className="size-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">{title}</span>
              {marked(entry) && <AgentMark />}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${title}`}
              title="Close (Alt+W)"
              className="shrink-0 opacity-0 group-hover/tab:opacity-100 group-data-[shown=true]/tab:opacity-100 focus-visible:opacity-100"
              onClick={() => frame.close(entry.id)}
            >
              <XIcon />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
