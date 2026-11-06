import { useMemo, useState } from "react"
import type { Listed, Look } from "@banda/contract/look"
import { Button } from "@banda/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@banda/ui/components/dropdown-menu"
import { useLook } from "@banda/ui/lib/look"
import { PaletteIcon } from "lucide-react"
import { writeSetting } from "./write-setting"

/** Which scheme shows: one, or the system's. */
type Shown = Look["mode"]

const MODES: readonly { value: Shown; title: string }[] = [
  { value: "system", title: "As the system" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
]

/** The theme now, its light or dark, and whether it has both. */
interface Now {
  /** Its name, as look.toml's `theme` takes it; none for a pair. */
  theme?: string
  /** What the menu calls it. */
  label?: string
  mode: Shown
  both: boolean
  /** The one scheme a theme with one has. */
  only?: "light" | "dark"
}

const BEFORE: Now = { mode: "system", both: true }

function nowOf(look: Look | null): Now {
  if (!look) return BEFORE
  const mine = look.settings["look.toml"]
  const said = mine?.theme?.value
  const mode = mine?.mode?.value
  const { light, dark } = look.schemes
  // Each scheme's theme is a layer: two for a pair, Banda's own included,
  // which are named <theme>-light and <theme>-dark (banda, macos).
  const layers = look.sources.filter((one) => one.layer === "theme")
  const own =
    layers.length > 1 && layers.every((one) => one.origin === "banda")
      ? layers[0]?.name?.replace(/-(light|dark)$/, "")
      : undefined
  const theme =
    typeof said === "string"
      ? said
      : said === undefined
        ? (own ?? layers[0]?.name)
        : undefined
  return {
    theme,
    label: theme ?? layers.map((one) => one.name).join(" / "),
    mode: mode === "light" || mode === "dark" ? mode : look.mode,
    both: light !== undefined && dark !== undefined,
    only: dark && !light ? "dark" : light && !dark ? "light" : undefined,
  }
}

/** Writes `key` of look.toml; the look brings the change back. */
const write = (key: string, value: string) =>
  writeSetting("look.toml", key, value)

/**
 * The theme, from the sidebar's foot (ADR 0007): light or dark, where the
 * theme has both, and the theme itself. It writes look.toml, as the
 * settings' Appearance does.
 */
export function ThemeMenu() {
  const shown = useLook((look) => look, null)
  const look = useMemo(() => nowOf(shown), [shown])
  // Asked of the desktop each time the menu opens, as a theme folder may
  // have come since.
  const [themes, setThemes] = useState<Listed[]>([])
  const host = window.banda
  const onOpenChange = (open: boolean) => {
    if (!open || !host) return
    host.settings.themes().then(setThemes, () => setThemes([]))
  }
  const current = themes.find((one) => one.origin === "current")
  const others = themes.filter((one) => one.origin !== "current")
  const title = look.label ? `Theme: ${look.label}` : "Theme"
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={title}
            title={title}
            className="text-muted-foreground"
          >
            <PaletteIcon />
          </Button>
        }
      />
      <DropdownMenuContent side="top" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {look.both
              ? "Light or dark"
              : `This theme is ${look.only ?? "one scheme"} only`}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={look.both ? look.mode : look.only}
            onValueChange={(next: string) => write("mode", next)}
          >
            {MODES.map(({ value, title }) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                disabled={!host || !look.both}
                closeOnClick
              >
                {title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!host}>
            <span className="flex-1">Theme</span>
            <span className="max-w-32 truncate text-xs text-muted-foreground">
              {look.label}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-52">
            <DropdownMenuRadioGroup
              value={look.theme}
              onValueChange={(next: string) => write("theme", next)}
            >
              <Theme name="banda" about="light and dark" />
              <Theme name="macos" about="the Mac's, light and dark" />
              {current && <Theme name="omarchy" about="follows Omarchy" />}
              <DropdownMenuSeparator />
              {others.map((one) => (
                <Theme key={one.name} name={one.name} about={one.mode} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Theme({ name, about }: { name: string; about: string }) {
  return (
    <DropdownMenuRadioItem value={name} closeOnClick>
      <span className="flex-1">{name}</span>
      <span className="ml-4 text-xs text-muted-foreground">{about}</span>
    </DropdownMenuRadioItem>
  )
}
