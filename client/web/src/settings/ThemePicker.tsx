/**
 * The theme, picked from the themes there are: Omarchy's current one,
 * Banda's and the Person's (ADR 0007). `banda look themes` lists them once
 * for the window.
 */
import { tomlOf } from "@banda/contract/settings"
import { useThemes } from "../look"
import type { CustomRow } from "@banda/ui/settings"
import { Choice } from "@banda/ui/components/setting-row"

export const ThemePicker: CustomRow = ({ setting, set }) => {
  const themes = useThemes(true)
  const value = setting?.value
  const options = themes.map((theme) => ({
    value: theme.name,
    about: `${theme.origin}, ${theme.mode}`,
  }))
  if (typeof value === "string" && !options.some((o) => o.value === value)) {
    options.unshift({ value, about: "" })
  }
  return (
    <Choice
      label="Theme"
      options={options}
      value={typeof value === "string" ? value : undefined}
      onPick={(picked) => set(tomlOf(picked))}
    />
  )
}
