/**
 * New Pane (ADR 0025, decision 4): a button for each Pane the Person can
 * start, which the launcher becomes, and a letter for each. It opens on
 * another machine too (ADR 0106, decision 2): there, what opens on that
 * machine is live, and the rest stays in view, dimmed, "Not on arc yet",
 * so nothing goes without a reason (call 6 A). It asks its `runs` what
 * opens, never where it is, and names no module: the Window hands it the
 * kinds it knows (`KindsContext`), so the code it takes is its own and
 * `@banda/ui`'s, which the kind checker passes.
 */
import type { JsonValue } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Kbd } from "@banda/ui/components/kbd"
import { useScope } from "@banda/ui/hooks/use-scope"
import { useModules, useStatus } from "@banda/ui/hooks/use-status"
import type { AnyPaneKind, Args as ActionArgs } from "@banda/ui/module"
import {
  definePane,
  type PaneProps,
  type PaneState,
  paneOf,
  type Place,
} from "@banda/ui/pane"
import { LayoutGridIcon } from "lucide-react"
import { createContext, useContext } from "react"

type Args = { [key: string]: JsonValue }

/** The kinds of Pane the Window knows, in the order it offers them, and
 * whether a kind's module runs on an engine that runs `modules`: the
 * registry's, which the Window hands what it draws. */
export type Kinds = {
  all: readonly AnyPaneKind[]
  runs: (kind: string, modules: readonly string[]) => boolean
}

/** The Window's kinds, for its launchers; none outside a Window. */
export const KindsContext = createContext<Kinds>({
  all: [],
  runs: () => false,
})

/** Lists the Panes a Person can open, and becomes the one picked. */
export const launcher = definePane<Args>({
  kind: "window.launcher",
  title: () => "New Pane",
  icon: LayoutGridIcon,
  elsewhere: true,
  Pane: Launcher,
})

/** A Pane the Person can start: live, or dimmed with why it does not open
 * from here. */
export type Choice = { pane: PaneState; kind: AnyPaneKind; why?: string }

/**
 * The Panes a Person can start where an engine runs `modules`: each kind
 * with a start whose module runs there, live where `runs` says it opens
 * from here; dimmed, with its words, where it says not. A kind whose
 * module that engine does not run, and that `runs` lets open, is left out,
 * as on this machine, where it comes back once the engine runs it.
 */
export function choicesOf(
  kinds: Kinds,
  modules: readonly string[],
  runs?: PaneProps<Args>["runs"]
): Choice[] {
  return kinds.all.flatMap((kind) => {
    if (!kind.start) return []
    const pane = paneOf(kind, kind.start)
    const opens = runs?.(pane) ?? { runs: true }
    if (!opens.runs) return [{ pane, kind, why: opens.why }]
    return kinds.runs(kind.kind, modules) ? [{ pane, kind }] : []
  })
}

/**
 * The launcher: a button for each Pane, which it becomes. Its letters are
 * its actions, which its scope runs: with Shift the Pane opens beside it,
 * and the launcher stays (ADR 0025, decision 4). While its engine is not
 * open, as its machine is away, nothing is picked: the Frame's pill says
 * why.
 */
function Launcher({ engine, open, runs }: PaneProps<Args>) {
  const kinds = useContext(KindsContext)
  const modules = useModules(engine)
  const reached = useStatus(engine).state === "open"
  const choices = choicesOf(kinds, modules, runs)
  const pick = (args: ActionArgs | undefined, place: Place) => {
    const choice = choices.find(
      (one) => one.why === undefined && one.pane.kind === args?.kind
    )
    if (!reached || !choice) return false
    open(choice.pane, place)
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
        choices={choices}
        letters
        off={!reached}
        onPick={(pane) => open(pane, "instead")}
      />
    </div>
  )
}

/**
 * A button for each Pane the Person can start (`choicesOf`), with its
 * letter where `letters`; those that do not open from here under them,
 * dimmed, with why (call 6 A). With `off`, none is picked.
 */
export function Choices({
  choices,
  letters = false,
  off = false,
  onPick,
}: {
  choices: readonly Choice[]
  letters?: boolean
  off?: boolean
  onPick: (pane: PaneState) => void
}) {
  const live = choices.filter((one) => one.why === undefined)
  const dimmed = choices.filter((one) => one.why !== undefined)
  const button = ({ pane, kind, why }: Choice) => {
    const Icon = kind.icon
    return (
      <Button
        key={pane.kind}
        variant="outline"
        disabled={off || why !== undefined}
        title={why}
        className={why === undefined ? undefined : "border-dashed"}
        onClick={() => onPick(pane)}
      >
        <Icon />
        {kind.title(pane.args)}
        {letters && kind.letter && <Kbd className="ml-1">{kind.letter}</Kbd>}
      </Button>
    )
  }
  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        {live.map(button)}
      </div>
      {dimmed.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap justify-center gap-2">
            {dimmed.map(button)}
          </div>
          <p className="text-xs text-muted-foreground">{dimmed[0]!.why}</p>
        </div>
      )}
    </>
  )
}
