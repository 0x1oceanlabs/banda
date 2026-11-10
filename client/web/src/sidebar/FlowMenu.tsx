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
import {
  Columns3Icon,
  FolderInputIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  RectangleHorizontalIcon,
} from "lucide-react"

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

/**
 * The Flow, from the sidebar's header (ADR 0079): its icon draws the one
 * in force, and its menu picks one by the Window's `flow.pick`, which
 * writes agents.toml beside `flow.solo`, its key. In the row and solo it
 * also offers Arrange by Project, as Panes already open stay where they
 * are (ADR 0102, decision 9).
 */
export function FlowMenu() {
  const run = useRun()
  const flow = useFile(AGENTS_FILE).flow
  const key = useKeyLabel()("flow.solo")
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
            title={key ? `${title} (${key})` : title}
            className="text-muted-foreground"
          >
            <Icon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>How the Agents' windows stand</DropdownMenuLabel>
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
                    <span className="text-xs text-muted-foreground">
                      {about}
                    </span>
                  </span>
                  {key && value !== "free" && (
                    <DropdownMenuShortcut>{key}</DropdownMenuShortcut>
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
