import { useState } from "react"
import type { ProjectId } from "@banda/contract"

/**
 * How the Person has the sidebar list in view, while the window draws it:
 * one Project's rows alone (`only`, which `pick` sets or clears), the
 * sections they folded or opened (`toggled`), those that show all their
 * rows (`more`), and the other machines they folded (`folded`), each
 * flipped by its key. Another `preset` starts afresh.
 */
export function useSidebarView(preset: string) {
  const [only, setOnly] = useState<ProjectId>()
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [more, setMore] = useState<ReadonlySet<string>>(new Set())
  // The other machines the Person folded, by their keys.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  // Another preset starts afresh: no filter, nothing folded by hand.
  const [arrangedBy, setArrangedBy] = useState(preset)
  if (arrangedBy !== preset) {
    setArrangedBy(preset)
    setOnly(undefined)
    setToggled(new Set())
    setMore(new Set())
    setFolded(new Set())
  }
  return {
    only,
    toggled,
    more,
    folded,
    /** Shows only `project`'s rows, or all again. */
    pick: (project: ProjectId) =>
      setOnly((was) => (was === project ? undefined : project)),
    toggle: (key: string) => setToggled((set) => flip(set, key)),
    toggleMore: (key: string) => setMore((set) => flip(set, key)),
    fold: (name: string) => setFolded((set) => flip(set, name)),
  }
}

/** `set` with `key` taken out, or put in where it was not. */
function flip(set: ReadonlySet<string>, key: string) {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}
