/**
 * The kinds of Pane this window knows and the Watches on what calls for
 * the Person, built from the modules (ADR 0022): theirs, and the window's
 * own, the launcher. A Pane or a Watch runs only while the engine runs
 * its module.
 */
import type { JsonValue } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { useModules } from "@banda/ui/hooks/use-status"
import { type AnyPaneKind, defineModule, type Module } from "@banda/ui/module"
import {
  definePane,
  type PaneProps,
  type PaneState,
  paneOf,
  type Watch,
} from "@banda/ui/pane"
import { LayoutGridIcon } from "lucide-react"
import { columnsOf } from "./look"
import { modules } from "./modules"
import type { Width } from "./workspaces/model"

type Args = { [key: string]: JsonValue }

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher: AnyPaneKind = definePane<Args>({
  kind: "window.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  Pane: Launcher,
})

/** The window's own things, as a module of their own. */
const windowModule = defineModule({
  id: "window",
  engine: false,
  panes: [launcher],
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

export function kindOf(kind: string): AnyPaneKind | undefined {
  return byKind.get(kind)?.kind
}

/** The one thing a Pane shows, as its kind names it (`PaneKind.shows`). */
export function showsOf(pane: PaneState): string | null {
  return kindOf(pane.kind)?.shows?.(pane.args) ?? null
}

/** A Pane's title and icon, as its kind gives them. */
export function labelOf(pane: PaneState) {
  const kind = kindOf(pane.kind)
  return {
    title: kind ? kind.title(pane.args) : "Unknown Pane",
    Icon: kind?.icon,
  }
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

function Launcher({ engine, open }: PaneProps<Args>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        What should this tile show?
      </p>
      <Choices
        modules={useModules(engine)}
        onPick={(pane) => open(pane, "here")}
      />
    </div>
  )
}

/** A button for each Pane a Person can start. */
export function Choices({
  modules,
  onPick,
}: {
  modules: readonly string[]
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
          </Button>
        )
      })}
    </div>
  )
}
