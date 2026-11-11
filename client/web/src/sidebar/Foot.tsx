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
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
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
import {
  BellIcon,
  BellOffIcon,
  FileCogIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react"
import { useState } from "react"
import { device } from "../boot"
import { choicesAt, quiet, quietWords, useQuiet } from "../calls/quiet"
import { useLookSidebar } from "../look"
import { useOpen } from "./open"
import { PRESET_WORDS } from "./settings"

/**
 * The sidebar's foot (ADR 0098, decision 21): Banda's settings, how the
 * sidebar arranges, and Quiet, as icons with no words, each tooltip with
 * its key in force where it has one. The key sheet and the theme went to
 * the Banda menu, which the bar's logo opens, and Add Project to ✎'s
 * menu. Its view menu writes the preset into `sidebar.toml`, through the
 * desktop, and the new arrangement comes back with the look.
 */
export function Foot() {
  const { preset, presets } = useLookSidebar()
  const keyFor = useKeyLabel()
  const open = useOpen()
  const host = window.banda
  const edit = () => {
    host?.sidebar.edit().catch((error: unknown) => {
      console.error("banda: sidebar.toml did not open", error)
    })
  }
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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`View: ${preset}`}
              title={`View: ${preset}`}
              className="text-muted-foreground"
            >
              <ListFilterIcon />
            </Button>
          }
        />
        <DropdownMenuContent side="top" className="w-auto min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>How the sidebar is arranged</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={preset}
              onValueChange={(next: string) => device.sidebar.preset(next)}
            >
              {presets.map(({ name, origin }) => (
                <DropdownMenuRadioItem
                  key={name}
                  value={name}
                  disabled={!host}
                  closeOnClick
                >
                  <span className="flex flex-col">
                    <span className="capitalize">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {origin === "yours"
                        ? "Your own preset"
                        : PRESET_WORDS[name]}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!host} onClick={edit}>
            <FileCogIcon />
            Edit sidebar.toml
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuietBell />
      {/* The machines come on the right (S13). */}
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
