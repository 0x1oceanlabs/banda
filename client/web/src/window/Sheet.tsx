import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Engine, ProjectId } from "@banda/contract"
import { type PaneState, paneOf } from "@banda/ui/pane"
import { kindOf, labelOf } from "../registry"
import { settingsPane } from "../settings/pane"
import type { Shell } from "./actions"
import { FLOATING, FloatingPane } from "./Peek"

/** What the Sheet shows: a Pane of a Project. */
export type Sheeted = { project: ProjectId; pane: PaneState }

/** Whether a Pane comes as the Sheet, as its kind says (`PaneKind.sheet`). */
export function sheetsOf(pane: PaneState): boolean {
  return kindOf(pane.kind)?.sheet === true
}

/** What takes an Esc before the Sheet: a menu, a dialog or a list of
 * suggestions in it. */
const OVER_SHEET = "[role=menu], [role=dialog], [role=listbox]"

/**
 * The Sheet's state: what it shows; `show`, which shows a Pane in it, in
 * its Project or the one `where` says the Person is in, keeps the one of
 * its kind shown `again: false`, and toggled takes it away; `settings`, at
 * `link`, else where they are; and `update`, the args its Pane keeps.
 */
export function useSheet(where: () => ProjectId) {
  const [sheet, setSheet] = useState<Sheeted | null>(null)
  const whereNow = useRef(where)
  useLayoutEffect(() => {
    whereNow.current = where
  })
  const close = useCallback(() => setSheet(null), [])
  // Takes it away while it has the keys, as `pane.close` does.
  const closeFocused = useCallback(() => {
    if (!document.activeElement?.closest("[data-sheet]")) return false
    setSheet(null)
    return true
  }, [])
  const show = useCallback(
    (
      pane: PaneState,
      project?: ProjectId,
      { toggle = false, again = true } = {}
    ) => {
      const into = project ?? whereNow.current()
      setSheet((was) => {
        if (was?.pane.kind !== pane.kind) return { project: into, pane }
        if (toggle) return null
        return again ? { project: into, pane } : was
      })
    },
    []
  )
  const settings = useCallback(
    (link?: string) =>
      show(
        paneOf(settingsPane, { link: link ?? "" }),
        undefined,
        // With no link, where they are.
        { again: link !== undefined && link !== "" }
      ),
    [show]
  )
  const update = useCallback(
    (pane: PaneState) => setSheet((was) => was && { ...was, pane }),
    []
  )
  return useMemo(
    () => ({ sheet, show, close, closeFocused, settings, update }),
    [sheet, show, close, closeFocused, settings, update]
  )
}

/**
 * The Sheet (ADR 0102, decision 5): Settings or Usage, in from the right
 * edge over the tiles. The row does not move, and a change to the look
 * shows on the tiles behind it at once. `Esc`, or a press on the tiles,
 * takes it away, and the focus goes back where it was; there is one at a
 * time.
 */
export function Sheet({
  state,
  engine,
  modules,
  shell,
}: {
  state: ReturnType<typeof useSheet>
  engine: Engine
  modules: readonly string[]
  /** What opens a Pane it asks for in the workspace, and runs actions. */
  shell: Pick<Shell, "open" | "run">
}) {
  const panel = useRef<HTMLElement>(null)
  const { sheet, close, update } = state
  const showing = sheet !== null
  // It takes the keys as it comes in, and gives them back as it goes.
  useEffect(() => {
    if (!showing) return
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    panel.current?.focus({ preventScroll: true })
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [showing])
  // A press on the tiles behind takes it away; the sidebar and the bar
  // stay the Person's, as their gear goes to it where it is. Esc takes it
  // away wherever the focus is, as it is the top layer, unless what has
  // the focus took the Esc, or it is in a menu, dialog or suggestions.
  useEffect(() => {
    if (!showing) return
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-stack]")) close()
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (target?.closest(OVER_SHEET)) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener("pointerdown", onDown, true)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [showing, close])
  if (!sheet) return null
  const { project, pane } = sheet
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-sheet-layer=""
    >
      <section
        ref={panel}
        tabIndex={-1}
        aria-label={labelOf(pane).title}
        data-sheet=""
        data-focused="true"
        className={`${FLOATING} pointer-events-auto absolute top-(--gap-outer) right-(--gap-outer) bottom-(--gap-outer) flex w-[min(40rem,calc(100%-2*var(--gap-outer)-var(--sidebar-inset,0px)))] animate-in flex-col overflow-hidden duration-200 ease-out fade-in-0 outline-none slide-in-from-right-8 motion-reduce:animate-none`}
      >
        <FloatingPane
          engine={engine}
          modules={modules}
          project={project}
          pane={pane}
          // Where the Flow says, as any Pane the Person opens.
          open={(project, pane) => shell.open(pane, project)}
          update={update}
          close={close}
          label={() => undefined}
          run={shell.run}
          focused
        />
      </section>
    </div>
  )
}
