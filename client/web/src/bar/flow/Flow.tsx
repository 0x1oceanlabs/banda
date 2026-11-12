/**
 * The Flow, on the bar beside the workspaces' numbers (ADR 0098, decision
 * 20): it arranges the workspaces, not the sidebar's list. Its icon draws the
 * one in force, and its menu picks one by the Window's `flow.pick`, which
 * writes agents.toml beside `flow.solo`, its key (ADR 0079). In the row
 * and solo it also offers Arrange by Project, as Panes already open stay
 * where they are (ADR 0102, decision 9).
 *
 *   in    flow   agents.toml's `flow`, as the look resolves it (`useFile`)
 *         keys   the key in force for `flow.solo` (`useKeyLabel`)
 *   draws the icon of the Flow in force, with `flow.solo`'s key in its
 *         title; a click opens its menu: Free, Row and Solo, each with
 *         its line, the one in force picked and the key beside Row and
 *         Solo; in the row and solo, Arrange by Project too
 *   runs  `flow.pick` with the Flow picked, and `workspaces.arrange` for
 *         Arrange by Project
 *   gives `isFlow` and `nextFlow` to the Window's `flow.pick` and
 *         `flow.solo` (`window/actions.ts`)
 */
import { AGENTS_FILE, type Flow } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useRun } from "@banda/core/react"
import { useFile } from "@banda/ui/lib/look"
import type { Widget } from "@banda/ui/module"
import {
  Columns3Icon,
  FolderInputIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  RectangleHorizontalIcon,
} from "lucide-react"

/** Each Flow's name, its line in the menu and its icon (ADR 0098,
 * decision 20): Free as the approved prototype words it, the row and solo
 * as they work since ADR 0102. */
const FLOWS: Record<Flow, { title: string; about: string; icon: LucideIcon }> =
  {
    free: {
      title: "Free",
      about: "Windows stay where you put them",
      icon: LayoutDashboardIcon,
    },
    row: {
      title: "Row",
      about: "Each Project on its own workspace",
      icon: Columns3Icon,
    },
    solo: {
      title: "Solo",
      about: "What has the focus, the whole screen wide",
      icon: RectangleHorizontalIcon,
    },
  }

/** Whether `value` names a Flow (ADR 0079), as `flow.pick` takes it. */
export function isFlow(value: unknown): value is Flow {
  return typeof value === "string" && Object.hasOwn(FLOWS, value)
}

/** `Alt+Shift+M` (ADR 0079): from the row to solo and back; from free to
 * solo. */
export function nextFlow(flow: Flow): Flow {
  return flow === "solo" ? "row" : "solo"
}

/** The Flow's widget, as the top of this file says. */
function FlowWidget() {
  const run = useRun()
  const flow = useFile(AGENTS_FILE).flow
  const keyFor = useKeyLabel()
  const key = keyFor("flow.solo")
  const Icon = FLOWS[flow].icon
  const title = `Flow: ${FLOWS[flow].title}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={title}
            title={keyFor("flow.solo", title)}
            className="text-muted-foreground"
          >
            <Icon />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        aria-label="Flow"
        className="w-auto min-w-64"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Flow</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={flow}
            onValueChange={(value) => run("flow.pick", { flow: value })}
          >
            {(Object.keys(FLOWS) as Flow[]).map((value) => {
              const { title, about, icon: Each } = FLOWS[value]
              return (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Each />
                  <span className="flex flex-col">
                    <span>{title}</span>
                    <span className="text-meta text-muted-foreground">
                      {about}
                    </span>
                  </span>
                  {/* Clear of the longest line, Solo's, so the two do
                      not read as one. */}
                  {key && value !== "free" && (
                    <DropdownMenuShortcut className="pl-6">
                      {key}
                    </DropdownMenuShortcut>
                  )}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {flow !== "free" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => run("workspaces.arrange")}>
              <FolderInputIcon />
              Arrange by Project
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The Flow's widget, the window's own, which its module lists. It has no
 * compact form: a narrow Bar reaches the Flow by its key, `flow.solo`. */
export const flowWidget: Widget = {
  id: "window.flow",
  about:
    "How the Agents' windows stand, free, in a row or solo, by its icon; click to pick one.",
  Widget: FlowWidget,
}
