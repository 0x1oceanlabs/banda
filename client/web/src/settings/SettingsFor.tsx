/**
 * "Settings for: This Mac / arc" (ADR 0106, decision 7, step 5b; Roma's
 * pick A, 2026-11-12): under the crumb, in a section with a part of the
 * machine's, which machine's part it shows. This one and each other in
 * `hosts.toml`, by the name and icon the Window shows it by. While the
 * one picked is not live, its pill says so under the switch.
 */
import { LaptopIcon } from "lucide-react"
import type { Shown } from "@banda/core"
import { MachineIcon } from "@banda/ui/components/machine-icon"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import { cn } from "@banda/ui/lib/utils"

/** "This Mac", as a choice reads. */
const THIS = THIS_COMPUTER.charAt(0).toUpperCase() + THIS_COMPUTER.slice(1)

export function SettingsFor({
  hosts,
  on,
  onPick,
}: {
  /** The other machines, as the Window shows them. */
  hosts: readonly Shown[]
  /** The one picked, by its key; none for this one. */
  on?: string
  onPick: (on: string | undefined) => void
}) {
  const choices = [
    { key: undefined, name: THIS, icon: <LaptopIcon /> },
    ...hosts.map((host) => ({
      key: host.name,
      name: host.named.name,
      icon: <MachineIcon icon={host.named.icon} />,
    })),
  ]
  return (
    <div className="flex items-center gap-2.5 border-b px-4 py-2 text-ui text-muted-foreground">
      <span id="settings-for">Settings for</span>
      <div
        role="radiogroup"
        aria-labelledby="settings-for"
        className="flex rounded-control border p-0.5"
      >
        {choices.map((choice) => (
          <button
            key={choice.key ?? ""}
            type="button"
            role="radio"
            aria-checked={choice.key === on}
            onClick={() => onPick(choice.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-small px-2.5 py-0.5 text-meta [&_svg]:size-3.5",
              choice.key === on && "bg-accent text-foreground"
            )}
          >
            {choice.icon}
            {choice.name}
          </button>
        ))}
      </div>
    </div>
  )
}
