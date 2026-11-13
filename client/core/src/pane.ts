/**
 * What the Window, its popped-out windows and main say of a Pane (ADR
 * 0087): what one tile shows, the host a Pane is on, and where a Pane
 * opens. The Pane contract itself, what a module offers and draws, is
 * `@banda/ui/pane`'s.
 */
import type { JsonValue } from "@banda/contract"

/** What one tile shows: a kind of Pane and its args. */
export type PaneState = { kind: string; args: { [key: string]: JsonValue } }

/**
 * Where a Pane opens, when its caller names a place, from the Pane that
 * opens it: in a new column to its right, below it in its column, instead
 * of it in its place, or in its Group, in the Deck right of it, as what a
 * Thread opens goes (ADR 0065). Left out by a Pane, the window shows it
 * where its workspace shows one of its kind, or to the right; left out by
 * a key or a menu, the engine places it by the Flow (ADR 0110).
 * `instead` is the word the engine's `workspaces.open` has (ADR 0087,
 * decision 14).
 */
export type Place = "right" | "below" | "instead" | "group"

/**
 * The device's own machine, as the core keys what it keeps of a machine
 * (ADR 0124): what waits for it, what was closed while it was away, and
 * its entry among the machines. No key of `hosts.toml` is empty, and a
 * Pane's args that name no host name it (`paneHost`).
 */
export const HERE = ""

/**
 * The other host of `hosts.toml` a Pane's args name under `host`, by its
 * name; none for this machine's. The directory says which machine has a
 * Project (ADR 0106, decision 1), so nothing writes it into the
 * arrangement any more: an arrangement written before keeps it, and it is
 * read only where the directory knows nothing of that Project
 * (`KeptHosts.hostOf`). The Frame hands its Pane the host the directory
 * says in its args (`withHost`), as the Thread still asks it, until its
 * slices take that away.
 */
export function paneHost(pane: Pick<PaneState, "args">): string | undefined {
  const host = pane.args.host
  return typeof host === "string" && host !== "" ? host : undefined
}

/** `pane` with host `host` in its args, as the Frame hands it to its Pane;
 * with none, `host` none. */
export function withHost(pane: PaneState, host: string | undefined): PaneState {
  if (paneHost(pane) === host) return pane
  const args = { ...pane.args }
  if (host === undefined) delete args.host
  else args.host = host
  return { ...pane, args }
}
