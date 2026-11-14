/**
 * The Flow as this device shows it (ADR 0127, decision 3; ADR 0087,
 * decision 10). Free and the row are how the engine places a Pane: the
 * Person's, `flow` in tiling.toml, the same on every device. Solo is a
 * view of the row, and each device's own: turned on or off here, it is
 * kept with this device's view and writes no file and no arrangement, so
 * another window on the same engine stays as it was.
 *
 * `flow = "solo"` in the file is the Person's default: the row, and a
 * device that has not chosen starts in Solo. A device has chosen while it
 * shows other than the default; back at the default, it follows it again.
 *
 *   in    file   tiling.toml's `flow`, as the look resolves it
 *         solo   this device's own choice, as `store.ts` keeps it
 *   gives `useFlowHere`, the Flow here and a pick of one, for the Window,
 *         which hands the Flow to what it draws (`kept.ts`) and the pick
 *         to its actions; the pick says what the file is to say when it
 *         changes how the engine places
 */
import { type Flow, TILING_FILE } from "@banda/contract/workspaces"
import { Store, useSelected } from "@banda/core/react"
import { fileNow, useFile } from "@banda/ui/lib/look"
import { useCallback, useState } from "react"
import { keepSolo, loadSolo } from "./store"

/** The Flow a device shows where the file says `file` and the device
 * chose `solo`: free as the file says, as Solo is a view of the row. */
export function flowHere(file: Flow, solo: boolean | undefined): Flow {
  if (file === "free") return "free"
  return (solo ?? file === "solo") ? "solo" : "row"
}

/**
 * What a pick of `flow` on a device does, where the file says `file` and
 * the device chose `solo`: the choice it keeps, and what the file is to
 * say (`write`) when the pick changes how the engine places, from free to
 * the row or back. Solo and the row apart are the device's alone. From
 * free, Solo takes the row with it, as it is a view of the row; a pick of
 * free leaves the device's choice, for when the row comes back.
 */
export function picked(
  flow: Flow,
  file: Flow,
  solo: boolean | undefined
): { solo: boolean | undefined; write?: "free" | "row" } {
  if (flow === "free")
    return { solo, ...(file !== "free" && { write: "free" }) }
  const wants = flow === "solo"
  // The Person's default once the file says the row.
  const byDefault = file === "solo"
  return {
    solo: wants === byDefault ? undefined : wants,
    ...(file === "free" && { write: "row" }),
  }
}

/** What a pick of a Flow gives: what tiling.toml's `flow` is to say now,
 * when the pick changes it. */
export type PickFlow = (flow: Flow) => "free" | "row" | undefined

/**
 * Solo as the Person chose it on this device; none while it follows the
 * Person's default. One per Window: read from the device's storage as
 * the Window starts, and kept there at each pick.
 */
export class Solo {
  readonly #chosen = new Store<boolean | undefined>(loadSolo())
  readonly get = this.#chosen.get
  readonly subscribe = this.#chosen.subscribe

  /** Picks `flow` on this device, where the file says `file`. */
  pick(flow: Flow, file: Flow): ReturnType<PickFlow> {
    const { solo, write } = picked(flow, file, this.#chosen.get())
    this.#chosen.set(solo)
    keepSolo(solo)
    return write
  }
}

/** The Flow this device shows, kept current, and a pick of one here. */
export function useFlowHere(): { flow: Flow; pick: PickFlow } {
  const [solo] = useState(() => new Solo())
  const file = useFile(TILING_FILE).flow
  const flow = flowHere(file, useSelected(solo.subscribe, solo.get))
  const pick = useCallback<PickFlow>(
    (flow) => solo.pick(flow, fileNow(TILING_FILE).flow),
    [solo]
  )
  return { flow, pick }
}
