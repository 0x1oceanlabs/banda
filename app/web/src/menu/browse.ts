/** The path field of "Add Space" (ADR 0026): what the engine says of a
 * path as it is typed. */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import { useAct } from "@banda/ui/hooks/use-act"
import type { Browsing } from "./menu"

/** The path field's words before it is typed into (ADR 0026). */
export const PATH_PLACEHOLDER = "Enter Project path (e.g. ~/code/my-app)"

/** The button that opens the system's folder picker, in T3 Code's words. */
export const PICK_FOLDER = "Open in Files"

/** The system's folder picker, opened in the folder the path field is
 * at (the engine's `parent`), or at home: `onPicked` hears the folder
 * picked, or none when the Person cancels. None in a bare page, which
 * has no desktop. */
export function usePickFolder(
  browsed: Browsing | undefined,
  onPicked: (folder: string | null) => void
) {
  const { busy, problem, act } = useAct()
  const picker = window.banda?.folder
  if (!picker) return undefined
  const pick = async () =>
    onPicked((await act(() => picker.pick(browsed?.parent ?? null))) ?? null)
  return { busy, problem, pick }
}

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
