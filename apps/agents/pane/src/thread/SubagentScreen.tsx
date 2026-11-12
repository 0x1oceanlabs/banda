/**
 * Sub-agents over their Thread, as screens on top, where the Thread's Pane
 * is alone (ADR 0103, decision 21; `screens.ts`): a narrow window, the
 * Drawer, Quick Look. A screen covers the Thread, its composer and dock
 * included, under the Pane's own header: a row with ←, its satellite, its
 * label and whose sub-agent it is, then the view its Pane beside draws
 * (`SubagentBody`). One of its own sub-agents is one more screen, in place
 * of the breadcrumb. ← or Esc goes one level up, and from the first back
 * to the Thread, as it was, the row it went from focused. Banda shows a
 * Harness's sub-agents and manages none (ADR 0103, call 11): no Stop.
 */
import { useEffect, useMemo, useRef } from "react"
import { ArrowLeftIcon } from "lucide-react"
import type { Engine, ProjectId } from "@banda/contract"
import type { SubagentId, ThreadId } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import { Satellite } from "@banda/ui/components/satellite"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useScope } from "@banda/ui/hooks/use-scope"
import { cn } from "@banda/ui/lib/utils"
import type { PaneProps } from "@banda/ui/pane"
import { FADES } from "../entries/parts/RowTrigger"
import { SUBAGENT } from "../scopes"
import type { Head } from "./beside"
import { back, NO_SCREENS, opened, type Screens, screenHeadOf } from "./screens"
import { SubagentBody, useSubagentLane } from "./SubagentPane"

/** What the screens of a Thread's Pane are drawn with. */
type Drawn = {
  engine: Engine
  project: ProjectId
  thread: ThreadId
  run: PaneProps<unknown>["run"]
  open: PaneProps<unknown>["open"]
}

/**
 * The screens over Thread `thread`, from the first to the one on top,
 * which alone shows and takes the keys; the ones under it keep their
 * scroll. What opens one, or goes back, or asks Claude about it, sets
 * new `screens` (`onScreens`). The Thread's view, `under`, gets the focus
 * back on the row it went from; while the Pane has the focus, the screen
 * on top holds it, for Esc.
 */
export function SubagentScreens({
  screens,
  focused,
  under,
  onScreens,
  ...drawn
}: Drawn & {
  screens: Screens
  focused: boolean
  under: React.RefObject<HTMLElement | null>
  onScreens: (screens: Screens) => void
}) {
  const stack = useRef<HTMLDivElement>(null)
  // The row that takes the focus once the screen it opened has gone.
  const landing = useRef<SubagentId>(undefined)
  const goBack = () => {
    const { screens: left, row } = back(screens)
    landing.current = row
    onScreens(left)
  }
  // What was opened takes the focus, or the row it went back to: in the
  // screen now on top, or in the Thread. Asked about, none: the Thread's
  // composer takes it, with the chip.
  useEffect(() => {
    const row = landing.current
    landing.current = undefined
    const top = stack.current?.lastElementChild
    const view = top instanceof HTMLElement ? top : under.current
    if (row !== undefined)
      view
        ?.querySelector<HTMLElement>(`[data-sub="${CSS.escape(row)}"]`)
        ?.focus({ preventScroll: true })
    else if (top instanceof HTMLElement) top.focus({ preventScroll: true })
  }, [screens, under])
  // The Pane focused again, as the Drawer dropped again: the screen on
  // top takes it, for Esc.
  useEffect(() => {
    const top = stack.current?.lastElementChild
    if (
      focused &&
      top instanceof HTMLElement &&
      !top.contains(document.activeElement)
    )
      top.focus({ preventScroll: true })
  }, [focused])
  return (
    <div ref={stack} className="contents">
      {screens.map((sub, at) => (
        <SubagentScreen
          // Each level is its own screen, which keeps its scroll.
          key={`${at} ${sub}`}
          {...drawn}
          sub={sub}
          top={at === screens.length - 1}
          onBack={goBack}
          onSub={(child) => onScreens(opened(screens, child))}
          onAsk={() => onScreens(NO_SCREENS)}
        />
      ))}
    </div>
  )
}

/** One sub-agent's screen; under the one on top, hidden and out of reach. */
function SubagentScreen({
  engine,
  project,
  thread,
  sub,
  top,
  run,
  open,
  onBack,
  onSub,
  onAsk,
}: Drawn & {
  sub: SubagentId
  top: boolean
  onBack: () => void
  onSub: (child: SubagentId) => void
  onAsk: () => void
}) {
  const lane = useSubagentLane(engine, project, thread, sub)
  const { drawn, own } = lane
  const head = useMemo(
    () =>
      drawn && own
        ? screenHeadOf(thread, own, drawn.subagents, drawn.title)
        : undefined,
    [drawn, own, thread]
  )
  const root = useRef<HTMLDivElement>(null)
  // Its key (ADR 0071, decision 1): Esc goes one level up, as ← does. It
  // keeps the Esc it takes: what holds the Pane, as the Drawer or Quick
  // Look, does not take it too.
  const scope = useScope(SUBAGENT, {
    "agents.subagent.up": (_, pressed) => {
      pressed?.stopPropagation()
      onBack()
      return true
    },
  })
  useEffect(() => scope(root.current), [scope])
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={head?.label ?? "Sub-agent"}
      data-slot="subagent-screen"
      inert={!top}
      className={cn(
        "absolute inset-0 flex flex-col outline-none",
        !top && "invisible"
      )}
    >
      <ScreenHead head={head} onBack={onBack} />
      <SubagentBody
        lane={lane}
        engine={engine}
        project={project}
        thread={thread}
        sub={sub}
        run={run}
        open={open}
        opens="over"
        onSub={onSub}
        onAsk={onAsk}
      />
    </div>
  )
}

/** Its header row, under the Pane's own: ←, its satellite at 12 px, its
 * label, and whose sub-agent it is, muted. Long words fade, with no "…". */
function ScreenHead({
  head,
  onBack,
}: {
  head: Head | undefined
  onBack: () => void
}) {
  const keyFor = useKeyLabel()
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 px-2.5 text-sm">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Back"
        title={keyFor("agents.subagent.up", "Back")}
        className="shrink-0"
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      {head && (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Satellite state={head.look} size={12} />
        </span>
      )}
      <h2
        className={cn(
          "max-w-[50%] min-w-0 shrink-0 font-medium text-muted-foreground group-data-[selected=true]/tile:text-foreground",
          FADES
        )}
      >
        {head?.label ?? "Sub-agent"}
      </h2>
      {head?.of && (
        <span
          className={cn("min-w-0 flex-1 basis-0 text-muted-foreground", FADES)}
        >
          {head.of}
        </span>
      )}
    </div>
  )
}
