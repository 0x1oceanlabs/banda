/**
 * The kinds of Pane this window knows: each module's, and the window's own
 * launcher; and each module's Watch on what calls for the Person. A Pane
 * or a Watch runs only while the engine runs its module.
 */
import { panes as agentPanes, threadsWatch } from "@banda/agents-pane"
import { panes as browserPanes } from "@banda/browser-pane"
import { panes as terminalPanes } from "@banda/terminal-pane"
import type { JsonValue } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { useModules } from "@banda/ui/hooks/use-status"
import {
  definePane,
  type PaneKind,
  type PaneProps,
  type PaneState,
  paneOf,
  type Watch,
} from "@banda/ui/pane"
import { LayoutGridIcon } from "lucide-react"
import { columnsOf } from "./look"
import type { Width } from "./workspaces/model"

type Args = { [key: string]: JsonValue }
type AnyKind = PaneKind<Args>

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher: AnyKind = definePane<Args>({
  kind: "window.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  Pane: Launcher,
})

/**
 * The Panes the modules offer. Each kind checks its own args; the window
 * hands it only the args it kept for it.
 */
const offered = [
  ...agentPanes,
  ...terminalPanes,
  ...browserPanes,
] as unknown as AnyKind[]

/** What the bar's mark hears from the modules (ADR 0005, decision 9). */
export const watches: Watch[] = [threadsWatch]

export const kinds: AnyKind[] = [launcher, ...offered]

export function kindOf(kind: string): AnyKind | undefined {
  return kinds.find((k) => k.kind === kind)
}

/** The one thing a Pane shows, as its kind names it (`PaneKind.shows`). */
export function showsOf(pane: PaneState): string | null {
  return kindOf(pane.kind)?.shows?.(pane.args) ?? null
}

/** Whether the engine runs what a kind of Pane, or a Watch, needs. */
export function runs(
  needs: { module?: string },
  engineModules: readonly string[]
): boolean {
  return needs.module === undefined || engineModules.includes(needs.module)
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
  return offered
    .filter((kind) => kind.start && runs(kind, engineModules))
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
