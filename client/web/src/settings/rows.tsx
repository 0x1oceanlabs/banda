/**
 * Rows a section draws itself (ADR 0016, decision 4), where the schema
 * alone draws them less well: a preset from the presets there are, a
 * sound to hear before it is chosen, and another machine on rows in the
 * Show card's words.
 */
import type { MachineRows } from "@banda/contract/sidebar"
import { tomlOf } from "@banda/contract/settings"
import { Button } from "@banda/ui/components/button"
import { type Chime, player } from "@banda/ui/sound"
import { PlayIcon } from "lucide-react"
import { useLookSidebar, useLookSound } from "../look"
import { PRESET_WORDS } from "../sidebar/settings"
import type { CustomRow } from "./sections"
import { Choice } from "./SettingRow"

/** The sidebar's preset, from Banda's and the Person's own. */
export const PresetPicker: CustomRow = ({ set }) => {
  const { preset, presets } = useLookSidebar()
  return (
    <Choice
      label="Preset"
      options={presets.map((p) => ({
        value: p.name,
        about: PRESET_WORDS[p.name] ?? "Your own preset",
      }))}
      value={preset}
      onPick={(picked) => set(tomlOf(picked))}
    />
  )
}

const MACHINE_ROWS: { value: MachineRows; words: string }[] = [
  { value: "named", words: "Icon and name" },
  { value: "icon", words: "Icon" },
  { value: "off", words: "Off" },
]

/** How another machine shows on its rows (ADR 0095, decision 9), in the
 * card's three words, where the schema would print its values. */
export const MachineRowsPicker: CustomRow = ({ row, setting, set }) => (
  <Choice
    label={row.title}
    options={MACHINE_ROWS}
    value={setting?.value}
    onPick={(picked) => set(tomlOf(picked))}
  />
)

/** A call's sound, `sound.done`, as the schema draws it, and a button to
 * hear it. */
export const PlaySound: CustomRow = ({ row, control }) => {
  const sound = useLookSound()
  const chime = row.key.split(".")[1] as Chime
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={`Play ${chime}`}
        title="Hear it"
        onClick={() => player.play(chime, sound)}
      >
        <PlayIcon />
      </Button>
      {control}
    </div>
  )
}
