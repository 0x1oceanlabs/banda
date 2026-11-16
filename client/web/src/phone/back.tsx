/**
 * The way back, in the header of the one Pane a phone shows (SE6): from
 * a Thread to the list; from a Pane opened from a Thread, as its Diff, to
 * what was there before it, by closing it. A phone has no key and no bar
 * for either. Beside the way to the list, how many call the Person there,
 * as the list's Your turn counts them: the Bar's counts, where there is
 * no Bar.
 */
import { useRun } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import type { Filler, HeaderProps } from "@banda/ui/slots"
import { ChevronLeftIcon } from "lucide-react"
import { groupedOf } from "../registry"
import { useCalls } from "./Form"
import { usePhone } from "./is"

function Back({ at, pane }: HeaderProps) {
  const run = useRun()
  const phone = usePhone()
  const calls = useCalls()
  if (!phone || at !== "start") return null
  // A Pane that is a Group of its own, as a Thread: what opens from it
  // joins its Group, and goes back to it.
  const toList = groupedOf(pane)
  return (
    <Button
      variant="ghost"
      size={toList && calls > 0 ? "sm" : "icon-sm"}
      data-phone-back=""
      aria-label={
        !toList
          ? "Back"
          : calls > 0
            ? `Back to the list: ${calls} call you`
            : "Back to the list"
      }
      className="-ml-1.5 shrink-0 gap-0.5 tabular-nums"
      onClick={() => run(toList ? "sidebar.show" : "pane.close")}
    >
      <ChevronLeftIcon />
      {toList && calls > 0 && calls}
    </Button>
  )
}

export const backHeader: Filler<"pane.header"> = {
  id: "window.back",
  slot: "pane.header",
  Fill: Back,
}
