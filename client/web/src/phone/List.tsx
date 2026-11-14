import { useRun } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import { SquarePenIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { Sidebar } from "../sidebar"
import { usual } from "../registry"
import { usePhone } from "./is"

/**
 * The window's list: the sidebar as it is. On a phone it is the home
 * screen, and has over its corner the one door a phone has to something
 * new: the Action the Apps say is usual first, a new Thread. There is no
 * key and no bar to ask for one.
 */
export function List(props: ComponentProps<typeof Sidebar>) {
  const phone = usePhone()
  const run = useRun()
  const first = usual
  return (
    <>
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
    </>
  )
}
