import { AGENTS_FILE, type Flow } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useFile } from "@banda/ui/lib/look"
import {
  Columns3Icon,
  LayoutDashboardIcon,
  type LucideIcon,
  RectangleHorizontalIcon,
} from "lucide-react"
import { writeSetting } from "./write-setting"

const FLOWS: Record<Flow, { title: string; about: string; icon: LucideIcon }> =
  {
    free: {
      title: "Free",
      about: "Windows stay where you put them",
      icon: LayoutDashboardIcon,
    },
    row: {
      title: "Row",
      about: "A Project's Agents side by side",
      icon: Columns3Icon,
    },
    solo: {
      title: "Solo",
      about: "The Agent you are at, the whole screen wide",
      icon: RectangleHorizontalIcon,
    },
  }

/** `Alt+Shift+M` (ADR 0079): from the row to solo and back; from free to
 * solo. */
export function nextFlow(flow: Flow): Flow {
  return flow === "solo" ? "row" : "solo"
}

/**
 * The Flow, from the sidebar's header (ADR 0079): its icon draws the one
 * in force, and its menu writes agents.toml.
 */
export function FlowMenu() {
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
            onValueChange={(value) =>
              writeSetting(AGENTS_FILE.name, "flow", value as Flow)
            }
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
