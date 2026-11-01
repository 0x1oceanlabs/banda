/**
 * What the desktop gives the page, on `window.bandaso`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out, and gets the look the desktop reads
 * (ADR 0007).
 */
import type { Address } from "@bandaso/contract"
import type { Look } from "@bandaso/contract/look"

export type Host = {
  /** Where the engine listens now; it waits while the engine starts. */
  engine: () => Promise<Address>
  /** `bandaso look --follow`, as the desktop hears it. */
  look: {
    /** The last look; none before the first. */
    current: () => Promise<Look | null>
    /** Calls `listener` with each new look; returns how to stop. */
    listen: (listener: (look: Look) => void) => () => void
  }
}

declare global {
  interface Window {
    bandaso?: Host
  }
}
