/**
 * What the desktop gives the page, on `window.bandaso`
 * (app/desktop/src/preload.ts). The page reaches the engine only through
 * the address it hands out.
 */
import type { Address } from "@bandaso/contract"

export type Host = {
  /** Where the engine listens now; it waits while the engine starts. */
  engine: () => Promise<Address>
}

declare global {
  interface Window {
    bandaso?: Host
  }
}
