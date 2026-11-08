/**
 * The kinds of Pane this window knows, the Watches on what calls for the
 * Person and the previewers that draw files, built from the modules (ADR
 * 0022): theirs, and the window's own, the launcher. A Pane or a Watch
 * runs only while the engine runs its module.
 */
import type { Engine, JsonValue } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Kbd } from "@banda/ui/components/kbd"
import type { Details } from "@banda/ui/components/thread-details"
import { useModules } from "@banda/ui/hooks/use-status"
import {
  type AnyPaneKind,
  type Args as ActionArgs,
  defineModule,
  type Listing,
  type Module,
  type Previewer,
  type Scope,
  scoped,
  type Source,
  takes,
  type Widget,
} from "@banda/ui/module"
import {
  definePane,
  type Label,
  type PaneProps,
  type PaneState,
  paneOf,
  type Place,
  type Watch,
} from "@banda/ui/pane"
import { useScope } from "@banda/ui/hooks/use-scope"
import { LayoutGridIcon, type LucideIcon } from "lucide-react"
import { memo, useCallback, useSyncExternalStore } from "react"
import { columnsOf } from "./look"
import { modules } from "./modules"
import { keepProblem } from "./problems/keep"
import { settingsPane } from "./settings/pane"
import type { Entry, Width } from "./tiling/model"

type Args = { [key: string]: JsonValue }

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher: AnyPaneKind = definePane<Args>({
  kind: "window.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  Pane: Launcher,
})

/** The launcher's scope (ADR 0071, decision 1): while it has the focus a
 * letter picks a Pane, the mod still held or not, as after Alt+N (ADR
 * 0025, decision 4). */
const LAUNCHER: Scope = { id: "launcher", title: "Launcher", modHeld: true }

/** The Settings Pane's scope: its search's key (ADR 0071, decision 1). */
const SETTINGS: Scope = { id: "settings", title: "Settings" }

/** The launcher's letters, each kind's that has one: in its place, and
 * with Shift beside it, the launcher staying. */
const opening = (id: string, title: string, shift: boolean) =>
  scoped(LAUNCHER.id, {
    id,
    title,
    section: "Launcher",
    args: takes({ kind: "the kind of Pane, as terminal.terminal" }, ["kind"]),
    keys: modules
      .flatMap((module) => module.panes)
      .filter((kind) => kind.letter && kind.start)
      .map((kind) => ({
        code: `Key${kind.letter}`,
        ...(shift && { shift }),
        args: { kind: kind.kind },
      })),
  })

/** The window's own things, as a module of their own: the launcher, its
 * letters, and the settings and their search (ADR 0016). */
export const windowModule = defineModule({
  id: "window",
  engine: false,
  panes: [launcher, settingsPane],
  actions: [
    opening("launcher.open", "Open a Pane in the launcher's place", false),
    opening("launcher.open-beside", "Open a Pane beside the launcher", true),
    scoped(SETTINGS.id, {
      id: "settings.search",
      title: "Search the settings",
      section: "Settings",
      keys: [{ code: "Slash" }],
    }),
  ],
  scopes: [LAUNCHER, SETTINGS],
})

const all: readonly Module[] = [windowModule, ...modules]

/** The Panes the modules offer, after the window's launcher. */
export const kinds: readonly AnyPaneKind[] = all.flatMap((m) => m.panes)

/** Each kind of Pane, and its module, by its kind. Its Pane is drawn
 * again only as its own props change (ADR 0088, decision 7): not as its
 * Tile's title or its Thread's mark does. */
const byKind = new Map(
  all.flatMap((module) =>
    module.panes.map(
      (kind) =>
        [
          kind.kind,
          { kind: { ...kind, Pane: memo(kind.Pane) }, module },
        ] as const
    )
  )
)

/** What the bar's mark hears from the modules (ADR 0005, decision 9), each
 * with its module. */
export const watches: readonly { watch: Watch; module: Module }[] = all.flatMap(
  (module) => module.watches.map((watch) => ({ watch, module }))
)

/** Where the Banda menu finds the modules' rows, each with its module. */
export const sources: readonly { source: Source; module: Module }[] =
  all.flatMap((module) => module.sources.map((source) => ({ source, module })))

/** How the modules draw kinds of file (ADR 0073, decision 6), in their
 * order: a Pane that shows a file picks among them. */
export const previewers: readonly Previewer[] = all.flatMap(
  (module) => module.previewers
)

/** What the modules show on the bar, each with its module, by its id.
 * Each is drawn again only as its own props change (ADR 0088, decision
 * 7). */
export const widgets: ReadonlyMap<string, { widget: Widget; module: Module }> =
  new Map(
    all.flatMap((module) =>
      module.bar.map(
        (widget) =>
          [
            widget.id,
            { widget: { ...widget, Widget: memo(widget.Widget) }, module },
          ] as const
      )
    )
  )
/** The rows a Thread's details card has of the modules that run, in the
 * modules' order. */
export function detailsOf(engineModules: readonly string[]): Details[] {
  return all
    .filter((module) => runs(module, engineModules))
    .flatMap((module) => module.threadDetails)
}

/** How the window names and marks a thing the module of `kind` lists,
 * found by the kind's first word (ADR 0022, decision 5; ADR 0077). */
export function listingOf(kind: string): Listing | undefined {
  const id = kind.split(".", 1)[0]
  return all.find((module) => module.id === id)?.listed
}

export function kindOf(kind: string): AnyPaneKind | undefined {
  return byKind.get(kind)?.kind
}

/** What broke a kind's words, each said once, not at every drawing. */
const broke = new Set<string>()

/**
 * What a kind says of a Pane, or `otherwise` when the Pane's args break
 * it: an Agent or an older Banda may have kept args the kind cannot read,
 * and one such Pane never takes the window down.
 */
function told<T>(say: () => T, otherwise: T): T {
  try {
    return say()
  } catch (error) {
    if (!broke.has(String(error))) {
      broke.add(String(error))
      console.error(error)
      keepProblem(error)
    }
    return otherwise
  }
}

/** The one thing a Pane shows, as its kind names it (`PaneKind.shows`). */
export function showsOf(pane: PaneState): string | null {
  return told(() => kindOf(pane.kind)?.shows?.(pane.args) ?? null, null)
}

/** Where a Pane opens from the sidebar, a call or a module: last on its
 * Project's workspace when its kind says so (`PaneKind.home`), else right
 * of the Pane in front. */
export function homeOf(pane: PaneState): "project" | "right" {
  return told(() => kindOf(pane.kind)?.home?.(), false) ? "project" : "right"
}

/** Whether a Pane opens as a Group of its own (`PaneKind.grouped`). */
export function groupedOf(pane: PaneState): boolean {
  return kindOf(pane.kind)?.grouped === true
}

/** A Pane as what makes it that one Pane (`PaneKind.identity`). */
export function identityOf(pane: PaneState): PaneState {
  const identity = kindOf(pane.kind)?.identity
  return told(
    () =>
      identity
        ? { kind: pane.kind, args: { identity: identity(pane.args) } }
        : pane,
    pane
  )
}

/** What Panes said they show now (`PaneProps.label`), by their entry:
 * kept while the window runs, not in its layout. */
let said: ReadonlyMap<string, Label> = new Map()
const hearing = new Set<() => void>()

/** Keeps what the Pane of `entry` says it shows now, or with `null`
 * forgets it. */
export function sayLabel(entry: string, label: Label | null): void {
  const was = said.get(entry)
  if (
    label === null
      ? !was
      : was?.title === label.title &&
        was.detail === label.detail &&
        was.edits === label.edits
  )
    return
  const next = new Map(said)
  if (label === null) next.delete(entry)
  else next.set(entry, label)
  said = next
  for (const hear of hearing) hear()
}

/** What Panes said they show now, by their entry. */
export function saidNow(): ReadonlyMap<string, Label> {
  return said
}

function hearSaid(hear: () => void): () => void {
  hearing.add(hear)
  return () => hearing.delete(hear)
}

/** What Panes said they show now, drawn again as one says another. */
export function useSaid(): ReadonlyMap<string, Label> {
  return useSyncExternalStore(hearSaid, saidNow)
}

/** What the Pane of `entry` said it shows now, drawn again only as it
 * says another. */
export function useLabel(entry: string): Label | undefined {
  const read = useCallback(() => said.get(entry), [entry])
  return useSyncExternalStore(hearSaid, read)
}

/** A Pane's title, quieter detail and icon: what it said it shows `now`,
 * else what its kind gives. */
export function labelOf(
  pane: PaneState,
  now?: Label
): Label & { Icon: LucideIcon | undefined } {
  const kind = kindOf(pane.kind)
  const Icon = kind?.icon
  if (!kind) return { title: "Unknown Pane", detail: null, Icon }
  if (now) return { ...now, Icon }
  return told(
    () => ({
      title: kind.title(pane.args),
      detail: kind.detail?.(pane.args) ?? null,
      Icon,
    }),
    { title: "Pane", detail: null, Icon }
  )
}

/** Lets a Pane's module let go of it (`PaneKind.closed`). */
export function closedOf(engine: Engine, entry: Entry): void {
  told(
    () =>
      kindOf(entry.pane.kind)?.closed?.({
        engine,
        project: entry.project,
        args: entry.pane.args,
      }),
    undefined
  )
}

/** Whether `module` runs: always, with no engine part; else while the
 * engine runs it. */
export function runs(module: Module, engineModules: readonly string[]) {
  return !module.engine || engineModules.includes(module.id)
}

/** Whether a kind of Pane's module runs. */
export function kindRuns(kind: string, engineModules: readonly string[]) {
  const known = byKind.get(kind)
  return known !== undefined && runs(known.module, engineModules)
}

/** Whether the Pane is a list that sits beside others (`PaneKind.narrow`). */
function narrow(pane: PaneState): boolean {
  return kindOf(pane.kind)?.narrow === true
}

/** How wide a new column for a Pane opens: a list at the narrowest
 * preset; the rest as the look says, by what is beside it. */
export function widthOf(pane: PaneState): Width | undefined {
  return narrow(pane) ? columnsOf().presets[0] : undefined
}

/**
 * The rem a column is never drawn narrower than, from the look's `min`:
 * the widest its Panes ask for; a list asks for half.
 */
export function minOf(
  column: { entries: readonly { pane: PaneState }[] },
  min: number
): number {
  return column.entries.some((entry) => !narrow(entry.pane)) ? min : min / 2
}

/** The Panes a Person can start, in the order the menu lists them. */
export function startable(engineModules: readonly string[]): PaneState[] {
  return kinds
    .filter((kind) => kind.start && kindRuns(kind.kind, engineModules))
    .map((kind) => paneOf(kind, kind.start!))
}

/**
 * The launcher: a button for each Pane, which it becomes. Its letters are
 * its actions, which its scope runs: with Shift the Pane opens beside it,
 * and the launcher stays (ADR 0025, decision 4).
 */
function Launcher({ engine, open }: PaneProps<Args>) {
  const modules = useModules(engine)
  const pick = (args: ActionArgs | undefined, place: Place) => {
    const pane = startable(modules).find((one) => one.kind === args?.kind)
    if (!pane) return false
    open(pane, place)
    return true
  }
  const scope = useScope(
    "launcher",
    {
      "launcher.open": (args) => pick(args, "instead"),
      "launcher.open-beside": (args) => pick(args, "right"),
    },
    { tile: true }
  )
  return (
    <div
      ref={scope}
      className="flex h-full flex-col items-center justify-center gap-3 p-6"
    >
      <p className="text-sm text-muted-foreground">
        What should this tile show?
      </p>
      <Choices
        modules={modules}
        letters
        onPick={(pane) => open(pane, "instead")}
      />
    </div>
  )
}

/** A button for each Pane a Person can start. */
export function Choices({
  modules,
  letters = false,
  onPick,
}: {
  modules: readonly string[]
  /** Each button shows the letter that picks it. */
  letters?: boolean
  onPick: (pane: PaneState) => void
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {startable(modules).map((pane) => {
        const kind = kindOf(pane.kind)!
        const Icon = kind.icon
        return (
          <Button
            key={pane.kind}
            variant="outline"
            onClick={() => onPick(pane)}
          >
            <Icon />
            {kind.title(pane.args)}
            {letters && kind.letter && (
              <Kbd className="ml-1">{kind.letter}</Kbd>
            )}
          </Button>
        )
      })}
    </div>
  )
}
