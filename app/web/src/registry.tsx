/**
 * The kinds of Pane this window knows: each module's, and the Desk's own
 * launcher. A tile shows a kind only while the engine runs its module.
 */
import { panes as agentPanes } from "@bandaso/agents-pane"
import { panes as terminalPanes } from "@bandaso/terminal-pane"
import type { JsonValue } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import { useModules } from "@bandaso/ui/hooks/use-status"
import {
  definePane,
  type PaneKind,
  type PaneProps,
  type PaneState,
  paneOf,
} from "@bandaso/ui/pane"
import { LayoutGridIcon } from "lucide-react"

type Args = { [key: string]: JsonValue }
type AnyKind = PaneKind<Args>

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher: AnyKind = definePane<Args>({
  kind: "desk.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  Pane: Launcher,
})

/**
 * The Panes the modules offer. Each kind checks its own args; the Desk
 * hands it only the args it kept for it.
 */
const offered = [...agentPanes, ...terminalPanes] as unknown as AnyKind[]

export const kinds: AnyKind[] = [launcher, ...offered]

export function kindOf(kind: string): AnyKind | undefined {
  return kinds.find((k) => k.kind === kind)
}

/** Whether the engine runs what a kind of Pane needs. */
export function runs(kind: AnyKind, engineModules: readonly string[]): boolean {
  return kind.module === undefined || engineModules.includes(kind.module)
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
