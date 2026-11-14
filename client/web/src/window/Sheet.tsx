import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ProjectId } from "@banda/contract"
import type { Owner } from "@banda/core"
import { HostsContext, useStore } from "@banda/core/react"
import { onDraw } from "@banda/ui/lib/frames"
import { holderOf, onPage, type PaneState, paneOf } from "@banda/ui/pane"
import { labelOf, sheetsOf } from "../registry"
import { settingsPane } from "../settings/pane"
import type { Change } from "../tiling/arrange"
import { type Entry, entries, type Workspaces } from "../tiling/model"
import { closing } from "../tiling/opening"
import type { Shell } from "./actions"
import { FLOATING, FloatingPane } from "./Peek"
import { useTop } from "./top"

/** What the Sheet shows: a Pane of a Project. */
export type Sheeted = { project: ProjectId; pane: PaneState }

/** Where a focus that goes takes the Sheet away: a tile, the dropped
 * drawer's, or the overview of them. */
const AWAY = "[data-stack], [data-drawer], [data-overview-state]"

/** Whether the keys going to `element` take the Sheet away: there, or to
 * a page a tile holds in the layer, as a browser's. */
export function awayTo(element: Element | null): boolean {
  return element?.closest(AWAY) != null || holderOf(element) !== null
}

/** Puts the keys in the Sheet's `panel`. A toast's button gives them back
 * where they were as it blurs, so they come in again. */
export function take(panel: HTMLElement | null) {
  panel?.focus({ preventScroll: true })
  if (panel && !panel.contains(document.activeElement))
    panel.focus({ preventScroll: true })
}

/** The tiles of a kind that comes as the Sheet, as a layout kept from
 * before it came holds them. */
export function sheetEntries(workspaces: Workspaces): Entry[] {
  return entries(workspaces).filter((entry) => sheetsOf(entry.pane))
}

/** Such tiles go once the workspaces are first drawn, quietly: they come
 * as the Sheet now. */
export function useSheetTilesGo(
  ready: boolean,
  drawnNow: () => Workspaces,
  change: (how: Change) => unknown
) {
  const gone = useRef(false)
  useEffect(() => {
    if (!ready || gone.current) return
    gone.current = true
    for (const entry of sheetEntries(drawnNow()))
      change(() => closing(entry.id))
  }, [ready, drawnNow, change])
}

/**
 * The Sheet's state: what it shows; `show`, which shows a Pane in it, in
 * its Project or the one `where` says the Person is in, keeps the one of
 * its kind shown `again: false`, and toggled takes it away; `asked`, how
 * often it was, as each time brings the keys in; `settings`, at `link`,
 * else where they are; and `update`, the args its Pane keeps.
 */
export function useSheet(where: () => ProjectId) {
  const [sheet, setSheet] = useState<Sheeted | null>(null)
  const [asked, setAsked] = useState(0)
  const whereNow = useRef(where)
  const sheetNow = useRef(sheet)
  useLayoutEffect(() => {
    whereNow.current = where
    sheetNow.current = sheet
  })
  // Takes it away while it shows, wherever the focus is, as `pane.close`
  // does: it is the top layer; false when none does.
  const close = useCallback(() => {
    if (!sheetNow.current) return false
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
      setAsked((times) => times + 1)
      setSheet((was) => {
        if (was?.pane.kind !== pane.kind) return { project: into, pane }
        if (toggle) return null
        return again ? { project: into, pane } : was
      })
    },
    []
  )
  const settings = useCallback(
    (link?: string, on?: string) =>
      show(
        paneOf(settingsPane, { link: link ?? "", ...(on && { on }) }),
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
    () => ({ sheet, asked, show, close, settings, update }),
    [sheet, asked, show, close, settings, update]
  )
}

/**
 * The Sheet (ADR 0102, decision 5): Settings or Usage, in from the right
 * edge over the tiles. The row does not move, and a change to the look
 * shows on the tiles behind it at once. It has the keys while it shows:
 * `Esc` while it is on top, `Alt+W`, a press on the tiles, a pick, or the
 * focus going to a Pane or the overview takes it away, and the keys go
 * back where they were; there is one at a time. Its Pane is on this
 * machine's engine, whatever machine's Project the Person is in. Usage is
 * this machine's; Settings are the window's, as each of their sections
 * acts for the machine whose parts it shows (ADR 0106, decision 1, step
 * 5b).
 */
export function Sheet({
  state,
  shell,
}: {
  state: ReturnType<typeof useSheet>
  /** What opens a Pane it asks for in the workspace, runs actions, and
   * this machine's engine, its Pane's. */
  shell: Pick<Shell, "open" | "run" | "engine">
}) {
  const panel = useRef<HTMLElement>(null)
  const { sheet, asked, close, update } = state
  const machine = useOwnMachine()
  const owner = sheet?.pane.kind === settingsPane.kind ? "window" : machine
  const showing = sheet !== null
  // On its layer of the Top layer's one stack, which takes it away on an
  // Esc nothing kept, and gives the keys back where they were as it goes
  // (`top/stack.ts`).
  useTop(showing, { part: "sheet", layer: "sheet", keys: true, close })
  // It takes the keys as it comes in, before it listens, as a toast's
  // button gives them back to a composer as it blurs. While it shows, a
  // press on the tiles behind takes it away, and so does the focus going
  // to a Pane, as Alt+1, a new Thread, the drawer dropped or the neighbour
  // of a Pane closed give it, or to the overview; the sidebar and the bar
  // stay the Person's, as their gear goes to it where it is. A focus that
  // falls to nothing, as with a search result gone as it is pressed, comes
  // back to it.
  useEffect(() => {
    if (!showing) return
    take(panel.current)
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-stack]")) close()
    }
    const onIn = (event: FocusEvent) => {
      if (awayTo(event.target instanceof Element ? event.target : null)) close()
    }
    const onOut = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (event.relatedTarget !== null || !target?.closest("[data-sheet]"))
        return
      onDraw(() => {
        const at = document.activeElement
        if ((!at || at === document.body) && document.hasFocus())
          panel.current?.focus({ preventScroll: true })
      })
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("focusin", onIn, true)
    document.addEventListener("focusout", onOut, true)
    // A page a tile holds takes the keys too, as `onPage` says.
    const offPage = onPage(() => close())
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("focusin", onIn, true)
      document.removeEventListener("focusout", onOut, true)
      offPage()
    }
  }, [showing, close])
  // Asked for again while it shows, as from the gear or Alt+, it takes
  // them again.
  useEffect(() => {
    if (showing) take(panel.current)
  }, [showing, asked])
  if (!sheet) return null
  const { project, pane } = sheet
  return (
    <div
      className="pointer-events-none absolute inset-0 z-sheet"
      data-sheet-layer=""
    >
      <section
        ref={panel}
        tabIndex={-1}
        aria-label={labelOf(pane).title}
        data-sheet=""
        data-top="sheet"
        data-focused="true"
        className={`${FLOATING} pointer-events-auto absolute top-(--gap-outer) right-(--gap-outer) bottom-(--gap-outer) flex w-[min(40rem,calc(100%-2*var(--gap-outer)-var(--sidebar-inset,0px)))] animate-in flex-col overflow-hidden duration-200 ease-out fade-in-0 outline-none slide-in-from-right-8 motion-reduce:animate-none`}
      >
        <FloatingPane
          engine={shell.engine}
          owner={owner}
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

/** This machine, by its Host scope's ID once its engine said it; the
 * window's until then. */
function useOwnMachine(): Owner {
  const hosts = useContext(HostsContext)
  const machine = useStore(
    hosts.machines,
    useCallback((all) => all.find((one) => one.host === undefined)?.machine, [])
  )
  return useMemo(() => (machine ? { machine } : "window"), [machine])
}
