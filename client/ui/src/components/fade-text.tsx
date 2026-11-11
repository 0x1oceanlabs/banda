/**
 * Text that fades out at its end where it does not fit, never with "…"
 * (ADR 0098, decision 8; the design reference's rule 10). The text is its
 * own scroll box, and a scroll timeline on it is live only while it holds
 * more than it shows: that timeline alone turns the mask on
 * (`[data-slot="fade-text"]` in globals.css), so text that fits has no
 * mask, and nothing measures it. Room to grow is its parent's to give.
 *
 * Inside `CutTips`, one that names its `tip` shows it whole in a tooltip
 * as the pointer rests on it, while it is cut, and only then.
 */
import { Tooltip } from "@base-ui/react/tooltip"
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react"
import { beside } from "@banda/ui/lib/beside"
import { cn } from "@banda/ui/lib/utils"

/** How long the pointer rests on cut text before its tooltip shows (ADR
 * 0098, spec §2.5). */
export const TIP_REST = 500

/** The one tooltip of the `FadeText`s inside a `CutTips`. */
const Tips = createContext<Tooltip.Handle<string> | undefined>(undefined)

export function FadeText({
  tip,
  className,
  ...props
}: ComponentProps<"span"> & {
  /** The whole text, shown while it is cut, inside `CutTips`. */
  tip?: string
}) {
  const tips = useContext(Tips)
  const text = (
    <span
      data-slot="fade-text"
      className={cn("min-w-0 overflow-hidden whitespace-nowrap", className)}
      {...props}
    />
  )
  if (!tips || !tip) return text
  return (
    <Tooltip.Trigger
      handle={tips}
      payload={tip}
      delay={TIP_REST}
      render={text}
    />
  )
}

/** Whether `element`, a `FadeText`, is cut: it holds more than it shows,
 * as its tooltip asks once the pointer rests on it. */
export function isCut(element: Element): boolean {
  return element.scrollWidth > element.clientWidth
}

/**
 * The tooltip the cut `FadeText`s inside it share, one for them all: as
 * the pointer rests on one, it shows its whole text, at most 3 lines and
 * 320 px wide, fading in over `--dur-fast`, past the right of the
 * trigger's nearest `edge`, level with it. The text's colour is its
 * ground, at the meta size, with the small radius (the design reference).
 * Text that fits gets none. It never takes the pointer, which goes on to
 * whatever is under it.
 */
export function CutTips({
  edge,
  children,
}: {
  /** What it stands beside, as a selector: the sidebar, or a menu. */
  edge: string
  children: ReactNode
}) {
  const [tips] = useState(() => Tooltip.createHandle<string>())
  const shown = useRef<Element>(undefined)
  return (
    <Tips value={tips}>
      {children}
      <Tooltip.Root
        handle={tips}
        disableHoverablePopup
        onOpenChange={(open, details) => {
          if (!open) return
          const { trigger } = details
          if (trigger && isCut(trigger)) shown.current = trigger
          else details.cancel()
        }}
      >
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner
              anchor={() =>
                shown.current ? beside(shown.current, edge) : null
              }
              side="right"
              align="start"
              sideOffset={6}
              className="isolate z-50"
            >
              <Tooltip.Popup
                data-slot="cut-tip"
                className="line-clamp-3 w-max max-w-80 rounded-small bg-foreground px-2 py-1 text-meta break-words text-background transition-opacity duration-(--dur-fast) ease-(--ease) data-ending-style:opacity-0 data-ending-style:duration-(--dur-out) data-ending-style:ease-(--ease-exit) data-starting-style:opacity-0"
              >
                {payload}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </Tips>
  )
}
