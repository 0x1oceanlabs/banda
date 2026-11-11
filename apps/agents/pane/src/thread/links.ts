/**
 * How a web link in a Thread opens, as the router says for its Project
 * (ADR 0106, law 3): in Banda's browser where that runs, else, and with
 * Ctrl always, in this device's. Each goes through the router, so no link
 * leaves the Pane past it: an address of another machine's own, as
 * `localhost` on arc, says whose it is instead (`link.open`).
 */
import { linkHint } from "@banda/ui/lib/links"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import type { PaneProps } from "@banda/ui/pane"
import type { ProjectId } from "@banda/contract"
import type { ThreadArgs } from "./session"

type Handles = Pick<PaneProps<ThreadArgs>, "run" | "runs">

export type ThreadLinks = {
  /** Opens `address` in Banda, or, with `outside`, in this device's
   * browser. */
  open: (address: string, outside: boolean) => void
  /** Whether it opens in Banda's browser. */
  inBanda: (address: string) => boolean
  /** Whether it opens from this device at all. */
  opensHere: (address: string) => boolean
  /** What it says under the pointer. */
  title: (address: string) => string
}

/** The web links of a Thread in `project`, from what its Pane holds. */
export function linksOf(
  { run, runs }: Handles,
  project: ProjectId
): ThreadLinks {
  const inBanda = (address: string) =>
    run !== undefined &&
    runs?.("browser.open", { address, project }).runs !== false
  const refused = (address: string) => {
    const opens = runs?.("link.open", { url: address })
    return opens && !opens.runs ? opens.why : undefined
  }
  return {
    inBanda,
    opensHere: (address) => refused(address) === undefined,
    open: (address, outside) => {
      if (!outside && inBanda(address))
        run?.("browser.open", { address, project })
      else run?.("link.open", { url: address })
    },
    title: (address) =>
      inBanda(address)
        ? linkHint(address)
        : (refused(address) ??
          `${address}\nOpens in ${THIS_COMPUTER}'s browser`),
  }
}
