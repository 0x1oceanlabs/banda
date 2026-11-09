/**
 * Another machine's battery as an icon (ADR 0097, decision 7), beside its
 * words: muted, in the text's colour, as a machine's own icon is, as the
 * words say the state and colour is the account's. A plug on power, a
 * bolt while it charges, else its level.
 */
import type { Battery } from "@banda/contract/machines"
import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryIcon as EmptyIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  type LucideIcon,
  PlugIcon,
} from "lucide-react"
import { cn } from "../lib/utils"

type Level = "charging" | "power" | "full" | "medium" | "low" | "empty"

const DRAWN: Readonly<Record<Level, LucideIcon>> = {
  charging: BatteryChargingIcon,
  power: PlugIcon,
  full: BatteryFullIcon,
  medium: BatteryMediumIcon,
  low: BatteryLowIcon,
  empty: EmptyIcon,
}

/** How `battery` stands, then how full it is. */
function levelOf({ percent, charging, on_power }: Battery): Level {
  if (charging) return "charging"
  if (on_power) return "power"
  if (percent > 66) return "full"
  if (percent > 33) return "medium"
  if (percent > 10) return "low"
  return "empty"
}

/** A machine's battery, at 12 px, drawn only: its words say it. */
export function BatteryIcon({
  battery,
  className,
}: {
  battery: Battery
  className?: string
}) {
  const Drawn = DRAWN[levelOf(battery)]
  return (
    <Drawn
      aria-hidden
      strokeWidth={2}
      className={cn("size-3 shrink-0 text-muted-foreground", className)}
    />
  )
}
