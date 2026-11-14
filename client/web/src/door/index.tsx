/**
 * A browser at a machine's door (ADR 0124, decision 6; SE5): the window,
 * once that machine has paired it; until then the card that asks to be.
 * A machine that says this device is its no more, in its own word, is
 * asked again: the page starts over with the pairing forgotten.
 */
import type { Engine } from "@banda/contract"
import { ownEngine } from "@banda/core"
import type { ReactNode } from "react"
import { browser, machineAtDoor, selfOf } from "../boot/browser"

/**
 * Opens the window with `open`, on the engine at the door, as the device
 * this machine paired; where it has paired none, `show`s the card that
 * asks, and opens once the Person allowed it.
 */
export async function atDoor(
  open: (engine: Engine) => void,
  show: (card: ReactNode) => void
): Promise<void> {
  const paired = () => {
    const engine = ownEngine(browser.engine)
    engine.watch((status) => {
      if (status.state !== "refused" || !status.signed) return
      // Why a door lets a device in no more, for good: it was removed
      // there, or the machine does not know it. A pipe on the way cannot
      // say so: only the host key's signature makes it the machine's.
      const { code } = status.refusal
      if (code !== "revoked" && code !== "forbidden") return
      void browser.forget().then(() => location.reload())
    })
    open(engine)
  }
  // The card's code is asked for with the pairing: a page that has
  // paired never draws it.
  const card = import("./Pairing")
  if (await browser.paired()) return paired()
  const [{ Pairing }, machine] = await Promise.all([card, machineAtDoor()])
  show(
    <Pairing
      machine={machine}
      suggested={selfOf(navigator.userAgent)}
      pair={browser.pair}
      onPaired={paired}
    />
  )
}
