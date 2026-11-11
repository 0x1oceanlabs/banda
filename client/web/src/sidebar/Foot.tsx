import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import { BellIcon, BellOffIcon, SettingsIcon } from "lucide-react"
import { type ContextType, useState } from "react"
import { choicesAt, quiet, quietWords, useQuiet } from "../calls/quiet"
import { BulkBar } from "./BulkBar"
import { useOpen } from "./open"
import { Bulk } from "./PickList"
import { ViewMenu } from "./ViewMenu"

/**
 * The sidebar's foot (ADR 0098, decision 21): Banda's settings, the view
 * menu and Quiet, as icons with no words, each tooltip with its key in
 * force where it has one. The key sheet and the theme went to the Banda
 * menu, which the bar's logo opens, and Add Project to ✎'s menu. While
 * cards are checked, the selection's bar lies over it, at its height, and
 * it goes under the bar (ADR 0098, decision 15): `bulk` is what the bar
 * acts on, and how.
 */
export function Foot({ bulk }: { bulk: ContextType<typeof Bulk> }) {
  const checking = bulk.rows.length > 0
  const keyFor = useKeyLabel()
  const open = useOpen()
  return (
    <div className="relative">
      <div
        inert={checking || undefined}
        className={cn(
          "flex items-center gap-0.5 px-1.5 pt-0.5 pb-1.5 transition-opacity duration-(--dur-fast) ease-(--ease)",
          checking && "opacity-0"
        )}
      >
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
        <QuietBell />
        {/* The machines come on the right (S13). */}
      </div>
      <Bulk value={bulk}>
        <BulkBar />
      </Bulk>
    </div>
  )
}

/** The bell and the crossed bell crossfade (spec §2.1). */
const FADES = "transition-opacity duration-(--dur-fast) ease-(--ease)"

/** The popover's rows, as the prototype draws them. */
const ROW =
  "flex h-8 items-center rounded-control px-1 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"

/**
 * Quiet's bell (ADR 0098, decision 21): crossed while it is on, the one
 * crossfading into the other. Its popover turns it on for 30 minutes, an
 * hour, until 9:00 or until turned off, or off, in the prototype's words.
 */
function QuietBell() {
  const on = useQuiet()
  const keyFor = useKeyLabel()
  // When the popover last opened: what its choices and words are of.
  const [now, setNow] = useState(Date.now)
  const quieted = on !== "off"
  const words = quietWords(on, now)
  const named = on === "on" ? "Quiet on" : words
  const key = keyFor("quiet.toggle")
  return (
    <Popover onOpenChange={(open) => open && setNow(Date.now())}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={named}
            title={key ? `${words} · ${key}` : words}
            data-quiet={quieted ? "" : undefined}
            className={cn(
              "relative",
              quieted
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground"
            )}
          />
        }
      >
        <BellIcon className={cn(FADES, quieted && "opacity-0")} />
        <BellOffIcon
          className={cn("absolute", FADES, !quieted && "opacity-0")}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 gap-0.5 p-2">
        <div className="px-1 pb-1">
          <PopoverTitle className="text-[13px]">{words}</PopoverTitle>
          <PopoverDescription>
            No sounds, no notifications, marks do not call. The inbox still
            fills.
          </PopoverDescription>
        </div>
        {quieted ? (
          <PopoverClose className={ROW} onClick={() => quiet.turn("off")}>
            Turn off
          </PopoverClose>
        ) : (
          choicesAt(now).map(({ words }, at) => (
            <PopoverClose
              key={words}
              className={ROW}
              // From the moment it is picked.
              onClick={() => quiet.turn(choicesAt(Date.now())[at]!.quiet)}
            >
              {words}
            </PopoverClose>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
