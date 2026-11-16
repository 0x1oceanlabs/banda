import { useRun } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { SquarePenIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { PushAsk } from "../devices/PushAsk"
import { Sidebar } from "../sidebar"
import { usual } from "../registry"
import { usePhone } from "./is"

/**
 * The window's list: the sidebar as it is. On a phone it is the home
 * screen. It has over its corner the one door a phone has to something
 * new: the Action the Apps say is usual first, a new Thread. There is no
 * key and no bar to ask for one. And over it, once, the card that asks
 * whether this phone takes pushes (SE7).
 *
 * The two frames lay nothing out but on a phone, where the card stands
 * over the list and the list takes what is left: so the list is the same
 * one as the form changes.
 */
export function List(props: ComponentProps<typeof Sidebar>) {
  const phone = usePhone()
  const run = useRun()
  const first = usual
  return (
    <div
      className={cn(
        "contents",
        phone && "absolute inset-0 z-sidebar flex flex-col bg-desk"
      )}
    >
      {phone && <PushAsk engine={props.engine} />}
      <div className={cn("contents", phone && "relative block min-h-0 flex-1")}>
        <Sidebar {...props} />
        {phone && first && (
          <Button
            size="icon-lg"
            data-phone-new=""
            aria-label={first.title}
            className="absolute right-6 bottom-16 z-sidebar rounded-full shadow-panel"
            onClick={() => {
              props.onDismiss?.()
              run(first.id)
            }}
          >
            <SquarePenIcon />
          </Button>
        )}
      </div>
    </div>
  )
}
