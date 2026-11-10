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
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import {
  FileCogIcon,
  FolderPlusIcon,
  KeyboardIcon,
  ListFilterIcon,
  SettingsIcon,
} from "lucide-react"
import { device } from "../boot"
import { useLookSidebar } from "../look"
import { useOpen } from "./open"
import { PRESET_WORDS } from "./settings"
import { ThemeMenu } from "./ThemeMenu"

/**
 * The sidebar's foot: Banda's settings and keys, its theme, and how the
 * sidebar arranges, with "Add Project" beside it. Its view menu writes
 * the preset into `sidebar.toml`, through the desktop, and the new
 * arrangement comes back with the look.
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
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label="Every action and its key"
        title={keyFor("menu.keys", "Every action and its key")}
        onClick={() => open("menu.at", { route: "actions" })}
      >
        <KeyboardIcon />
      </Button>
      <ThemeMenu />
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
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label="Add Project"
        title="Add Project"
        onClick={() => open("project.add")}
      >
        <FolderPlusIcon />
      </Button>
    </div>
  )
}
