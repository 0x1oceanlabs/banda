/**
 * The kinds of Pane this window knows and the Watches on what calls for
 * the Person, built from the modules (ADR 0022): theirs, and the window's
 * own, the launcher. A Pane or a Watch runs only while the engine runs
 * its module.
 */
import type { Engine, JsonValue } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Kbd } from "@banda/ui/components/kbd"
import { useModules } from "@banda/ui/hooks/use-status"
import {
  type AnyPaneKind,
  defineModule,
  type Module,
  type Source,
} from "@banda/ui/module"
import {
  definePane,
  type Label,
  type PaneProps,
  type PaneState,
  paneOf,
  type Watch,
} from "@banda/ui/pane"
import { LayoutGridIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import { columnsOf } from "./look"
import { modules } from "./modules"
import { settingsPane } from "./settings/pane"
import type { Entry, Width } from "./workspaces/model"

type Args = { [key: string]: JsonValue }

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher: AnyPaneKind = definePane<Args>({
  kind: "window.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  Pane: Launcher,
})

/** The window's own things, as a module of their own: the launcher and
 * the settings (ADR 0016). */
const windowModule = defineModule({
  id: "window",
  engine: false,
  panes: [launcher, settingsPane],
})

const all: readonly Module[] = [windowModule, ...modules]

/** The Panes the modules offer, after the window's launcher. */
export const kinds: readonly AnyPaneKind[] = all.flatMap((m) => m.panes)

/** Each kind of Pane, and its module, by its kind. */
const byKind = new Map(
  all.flatMap((module) =>
    module.panes.map((kind) => [kind.kind, { kind, module }] as const)
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
    }
    return otherwise
  }
}

/** The one thing a Pane shows, as its kind names it (`PaneKind.shows`). */
export function showsOf(pane: PaneState): string | null {
  return told(() => kindOf(pane.kind)?.shows?.(pane.args) ?? null, null)
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
      : was?.title === label.title && was.detail === label.detail
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

/** What Panes said they show now, drawn again as one says another. */
export function useSaid(): ReadonlyMap<string, Label> {
  return useSyncExternalStore((hear) => {
    hearing.add(hear)
    return () => hearing.delete(hear)
  }, saidNow)
}

/** A Pane's title, quieter detail and icon: what it said it shows `now`,
 * else what its kind gives. */
export function labelOf(pane: PaneState, now?: Label) {
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
        space: entry.space,
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
 * The launcher: a button for each Pane, which it becomes. While it has the
 * focus a letter picks one, as each button shows, Alt held or not; with
 * Shift the Pane opens beside it, and the launcher stays (ADR 0025,
 * decision 4).
 */
function Launcher({ engine, open, focused }: PaneProps<Args>) {
  const modules = useModules(engine)
  const now = useRef({ modules, open })
  useLayoutEffect(() => {
    now.current = { modules, open }
  })
  useEffect(() => {
    if (!focused) return
    const onKey = (event: KeyboardEvent) => {
      // Alt may still be held from Alt+N; a key an action took is its.
      if (event.ctrlKey || event.metaKey || event.repeat) return
      if (event.defaultPrevented) return
      const pane = startable(now.current.modules).find(
        (pane) => event.code === `Key${kindOf(pane.kind)?.letter}`
      )
      if (!pane) return
      event.preventDefault()
      now.current.open(pane, event.shiftKey ? "right" : "here")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused])
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        What should this tile show?
      </p>
      <Choices
        modules={modules}
        letters
        onPick={(pane) => open(pane, "here")}
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
