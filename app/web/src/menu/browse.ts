/** The path field of "Add Space" (ADR 0026): what the engine says of a
 * path as it is typed. */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Browsing } from "./menu"

/** The path field's words before it is typed into (ADR 0026). */
export const PATH_PLACEHOLDER = "Enter Space path (e.g. ~/code/my-app)"

/** The folders that fit `partial`, from the engine: the last it said, so
 * the list stays while the next is read; none for no `partial`. */
export function useBrowsed(
  engine: Engine,
  partial: string | undefined
): Browsing | undefined {
  const [said, setSaid] = useState<Browsing>()
  const typed = partial?.trim()
  useEffect(() => {
    if (!typed) return
    let stale = false
    engine.call("spaces.browse", { partial: typed }).then(
      (browsed) => !stale && setSaid({ ...browsed, partial: typed }),
      () => {}
    )
    return () => {
      stale = true
    }
  }, [engine, typed])
  return typed ? said : undefined
}
