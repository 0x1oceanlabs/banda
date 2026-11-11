import { Button } from "@banda/ui/components/button"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { SettingsIcon } from "lucide-react"
import { useOpen } from "./open"
import { ViewMenu } from "./ViewMenu"

/**
 * The sidebar's foot (ADR 0098, decision 21): Banda's settings and the
 * view menu, as icons with no words, each tooltip with its key in force
 * where it has one. The key sheet and the theme went to the Banda menu,
 * which the bar's logo opens, and Add Project to ✎'s menu.
 */
export function Foot() {
  const keyFor = useKeyLabel()
  const open = useOpen()
  return (
    <div className="flex items-center gap-0.5 px-1.5 pt-0.5 pb-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label="Settings"
        title={keyFor("settings.open", "Settings")}
        onClick={() => open("settings.open")}
      >
        <SettingsIcon />
      </Button>
      <ViewMenu />
      {/* Quiet's bell comes here (S9d), and the machines on the right
        (S13). */}
    </div>
  )
}
