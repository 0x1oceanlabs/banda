/**
 * How the limits' widget looks (ADR 0055, decision 2): what the Person
 * picks from its context menu, a row run as an action, as every menu
 * row is (`harnesses.limits.look`). The action writes `limits.look` in
 * harnesses.toml, which the engine reads as it answers. The widget is not
 * where the action runs, so what the write came to is kept here for it:
 * it reads the limits again once one is written, and keeps the words of
 * one refused, as it did when it wrote the file itself.
 */
import type { LimitsLook } from "@banda/contract/harnesses"
import { tomlOf } from "@banda/contract/settings"
import { Store } from "@banda/ui/lib/store"
import { type Action, takes } from "@banda/ui/module"

/** The looks the Person picks from, as its context menu names them. */
export const LOOKS: readonly { look: LimitsLook; words: string }[] = [
  { look: "icon", words: "Icon" },
  { look: "meter", words: "Meter and share" },
  { look: "number", words: "Share" },
  { look: "providers", words: "Share of each Harness" },
]

/** What a pick came to: written, or refused with the settings' words. */
export type Picked = { refused?: string }

/**
 * Each pick's answer, a new value for each, which the widget hears: the
 * harnesses module's own, from its action to its widget.
 */
export const picked = new Store<Picked | null>(null)

/** Writes the look `look` names for the limits' widget. */
export const pickLook: Action = {
  id: "harnesses.limits.look",
  title: "Show the usage limits as",
  section: "Harnesses",
  unlisted: true,
  args: takes(
    {
      look: `how the widget shows them: ${LOOKS.map((one) => one.look).join(", ")}`,
    },
    ["look"]
  ),
  run: (window, args = {}) => {
    const look = LOOKS.find((one) => one.look === args.look)?.look
    if (!look) return
    void window
      .writeSetting("harnesses.toml", "limits.look", tomlOf(look))
      .then((refused) =>
        picked.set(refused.length > 0 ? { refused: refused.join(" ") } : {})
      )
  },
}
