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
import { writeFlow } from "../flow"

const FLOWS: readonly {
  value: Flow
  title: string
  about: string
  icon: LucideIcon
}[] = [
  {
    value: "free",
    title: "Free",
    about: "Windows stay where you put them",
    icon: LayoutDashboardIcon,
  },
  {
    value: "row",
    title: "Row",
    about: "A Project's Agents side by side",
    icon: Columns3Icon,
  },
  {
    value: "solo",
    title: "Solo",
    about: "The Agent you are at, the whole screen wide",
    icon: RectangleHorizontalIcon,
  },
]

/**
 * The Flow, from the sidebar's header (ADR 0079): its icon draws the one
 * in force, and its menu writes agents.toml.
 */
export function FlowMenu() {
  const flow = useFile(AGENTS_FILE).flow
  const keyFor = useKeyLabel()
  const key = keyFor("flow.solo")
  const now = FLOWS.find((one) => one.value === flow) ?? FLOWS[1]
  const Icon = now.icon
  const title = `Flow: ${now.title}`
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
      <DropdownMenuContent align="end" className="w-auto min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>How the Agents' windows stand</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={flow}
            onValueChange={(value) => writeFlow(value as Flow)}
          >
            {FLOWS.map(({ value, title, about, icon: Each }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Each />
                <span className="flex flex-col">
                  <span>{title}</span>
                  <span className="text-xs text-muted-foreground">{about}</span>
                </span>
                {key && value !== "free" && (
                  <DropdownMenuShortcut>{key}</DropdownMenuShortcut>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
