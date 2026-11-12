/**
 * Another machine as the window draws it (ADR 0095, decision 1): one of
 * ten Lucide icons in the text's colour, muted, with no ground and no
 * colour of its own, as colour is the account's; and its name, as its
 * engine said it and the page cleaned it (`cleanNamed`), drawn as text.
 * The compact form, on a row: the icon at 12 px and the name in
 * `text-meta`. The full form, on a label or a Pane's header: the icon at
 * 14 px and the name.
 */
import type { MachineIcon as Icon, Named } from "@banda/contract/machines"
import {
  DatabaseIcon,
  HardDriveIcon,
  LaptopIcon,
  type LucideIcon,
  MonitorCloudIcon,
  MonitorIcon,
  PcCaseIcon,
  RouterIcon,
  ServerIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react"
import { cn } from "@banda/ui/lib/utils"

const DRAWN: Readonly<Record<Icon, LucideIcon>> = {
  laptop: LaptopIcon,
  desktop: MonitorIcon,
  tower: PcCaseIcon,
  server: ServerIcon,
  database: DatabaseIcon,
  storage: HardDriveIcon,
  router: RouterIcon,
  vm: MonitorCloudIcon,
  phone: SmartphoneIcon,
  tablet: TabletIcon,
}

/** A machine's icon, at `size` px, drawn only: its name says it. */
export function MachineIcon({
  icon,
  size = 12,
  className,
}: {
  icon: Icon
  size?: 12 | 14 | 20
  className?: string
}) {
  const Drawn = DRAWN[icon]
  return (
    <Drawn
      aria-hidden
      data-machine-icon={icon}
      strokeWidth={2}
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
    />
  )
}

/**
 * A machine's icon and name: `compact` on a row, its name at most 64 px
 * and cut; `full` on a label or a header; `icon` alone, where a row of
 * one line has no room, its name in the tooltip.
 */
export function MachineMark({
  named,
  form,
  title,
  className,
}: {
  named: Named
  form: "compact" | "full" | "icon"
  /** The tooltip; the name, where the icon draws alone. */
  title?: string
  className?: string
}) {
  return (
    <span
      title={title ?? (form === "icon" ? named.name : undefined)}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center text-muted-foreground",
        form === "full" ? "gap-1.5" : "gap-1 text-meta",
        className
      )}
    >
      <MachineIcon icon={named.icon} size={form === "full" ? 14 : 12} />
      {form === "icon" ? (
        <span className="sr-only">{named.name}</span>
      ) : (
        <span className={cn("truncate", form === "compact" && "max-w-16")}>
          {named.name}
        </span>
      )}
    </span>
  )
}
