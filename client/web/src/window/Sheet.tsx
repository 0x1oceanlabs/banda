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
import {
  HostsContext,
  type KeptHosts,
  useHosts,
  useStore,
} from "@banda/core/react"
import { TileHeader } from "@banda/ui/components/pane-header"
import { onDraw } from "@banda/ui/lib/frames"
import { holderOf, onPage, type PaneState, paneOf } from "@banda/ui/pane"
import { kindOf, labelOf, sheetsOf } from "../registry"
import { settingsPane } from "../settings/pane"
import { SettingsFor } from "../settings/SettingsFor"
import type { Change } from "../tiling/arrange"
import { type Entry, entries, type Workspaces } from "../tiling/model"
import { closing } from "../tiling/opening"
import type { Shell } from "./actions"
import { MachinePill } from "./named"
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
 * back where they were; there is one at a time. Settings are the
 * window's, on this machine's engine, as each of their sections acts for
 * the machine whose parts it shows (ADR 0106, decision 1, step 5b). A
 * Pane whose kind says `elsewhere`, as Usage, is one machine's, on that
 * machine's engine: the switch under its header says whose (`useFor`).
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
  const hosts = useContext(HostsContext)
  const of = useFor(hosts, sheet, update)
  const own = useOwnMachine()
  const owner: Owner =
    sheet?.pane.kind === settingsPane.kind
      ? "window"
      : of.there?.machine
        ? { machine: of.there.machine }
        : own
  const header = useMemo(() => ({ under: of.under }), [of.under])
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
        <TileHeader value={header}>
          <FloatingPane
            engine={of.there ? hosts.engine(of.there.name) : shell.engine}
            owner={owner}
            elsewhere={of.there !== undefined}
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
        </TileHeader>
      </section>
    </div>
  )
}

/** This machine's Host scope's ID, once its engine said it. */
function useOwnId(): ProjectId | undefined {
  const hosts = useContext(HostsContext)
  return useStore(
    hosts.machines,
    useCallback((all) => all.find((one) => one.host === undefined)?.machine, [])
  )
}

/** This machine, by its Host scope's ID; the window's until then. */
function useOwnMachine(): Owner {
  const machine = useOwnId()
  return useMemo(() => (machine ? { machine } : "window"), [machine])
}

/**
 * Whose the Sheet's Pane is, where its kind says `elsewhere` (ADR 0120,
 * decision 5): the machine its args name, `machine`, by its Host scope's
 * ID; while they name none, the machine of the Project the Person opened
 * it in. `there` is that machine where it is another; `under` the switch
 * between this machine and the others whose ID the Window knows, the
 * same as Settings', and that machine's pill while the Window does not
 * reach it. A pick is kept in the Pane's args.
 */
function useFor(
  hosts: KeptHosts,
  sheet: Sheeted | null,
  update: (pane: PaneState) => void
) {
  const others = useHosts()
  const own = useOwnId()
  const kind = sheet && kindOf(sheet.pane.kind)
  return useMemo(() => {
    if (!sheet || !kind?.elsewhere) return {}
    const { project, pane } = sheet
    const known = others.filter((host) => host.machine !== undefined)
    const named = pane.args.machine
    const there =
      named === undefined
        ? known.find((host) => host.name === hosts.hostOf(project))
        : known.find((host) => host.machine === named)
    if (known.length === 0 || own === undefined) return { there }
    const under = (
      <>
        <SettingsFor
          of={kind.name ?? labelOf(pane).title}
          hosts={known}
          on={there?.name}
          onPick={(name) =>
            update({
              ...pane,
              args: {
                ...pane.args,
                machine:
                  known.find((host) => host.name === name)?.machine ?? own,
              },
            })
          }
        />
        {there && there.state.state !== "live" && (
          <div className="flex justify-center pt-2">
            <MachinePill
              shown={there}
              onStart={() => hosts.start(there.name)}
            />
          </div>
        )}
      </>
    )
    return { there, under }
  }, [sheet, kind, others, own, hosts, update])
}
