import type { Engine, Status } from "@banda/contract"
import {
  BandaMark,
  loudest,
  MARK_WORDS,
  type MarkState,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { BellOffIcon, TriangleAlertIcon } from "lucide-react"
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Problem } from "@banda/contract/look"
import { useQuiet } from "../calls/quiet"
import { barAttention, useCalls } from "../calls/stores"
import { useLookProblems } from "../look"
import { type Layout, moved, same, written } from "./arrange"
import { PARTS, type Part } from "./placed"
import { UpdateWidget } from "./Update"
import type { Drawn } from "./Widgets"
import { useKeyLabel, useHoldsMod } from "@banda/ui/hooks/use-key-of"
import { useRun } from "@banda/core/react"
import { useStatus } from "@banda/ui/hooks/use-status"

/**
 * The bar across the window's top (ADR 0005, decision 9): Banda's mark on
 * the left, which opens the Banda menu (ADR 0098, decision 21) and shows
 * the loudest state of the work, with how many things wait for the Person
 * when more than one does, and a crossed bell while Quiet is on; `Alt+A`,
 * and the menu's action, show and hide the sidebar. The widgets, the
 * Tiling's workspaces among them, stand on the left, in the middle,
 * centred on the window whatever the sides hold, and on the right before
 * the engine's connection, as the look's `[bar]` lists them (ADR 0024). With the mod held, the mouse moves one (ADR 0064).
 * What calls, for its Mark, and how many Agents work, it reads from the
 * Window's stores.
 */
export function Bar({
  engine,
  problems,
  widgets,
  listed,
  onArrange,
}: {
  /** This machine's engine: its connection, and its updates. */
  engine: Engine
  /** What the window finds wrong in the files besides, as in keys.toml. */
  problems: readonly Problem[]
  /** The widgets of each part, drawn. */
  widgets: Partial<Record<Part, readonly Drawn[]>>
  /** `[bar]`'s lists, which a widget moved with the mod rewrites. */
  listed?: Layout
  /** Writes `[bar]`'s lists once a widget moved with the mod. */
  onArrange?: (bar: Layout) => void
}) {
  const status = useStatus(engine)
  const keyFor = useKeyLabel()
  const run = useRun()
  // What the modules' work calls the Person for, for the mark to show.
  const attention = useCalls(barAttention)
  const mark = loudest([attention.mark, markOf(status)])
  const { waiting } = attention
  const quiet = useQuiet() !== "off"
  const words =
    (mark === "rest" ? "" : ` · ${MARK_WORDS[mark]}`) +
    (waiting > 1 ? ` · ${waiting} wait for you` : "") +
    (quiet ? " · Quiet on" : "")
  const nodes = useMemo(
    () =>
      new Map(
        PARTS.flatMap((part) =>
          (widgets[part] ?? []).map((one) => [one.id, one.node] as const)
        )
      ),
    [widgets]
  )
  const shown = useMemo(() => layoutOf(widgets), [widgets])
  const header = useRef<HTMLElement>(null)
  const write = useCallback(
    (after: Layout) => onArrange?.(written(listed ?? shown, shown, after)),
    [onArrange, listed, shown]
  )
  const { layout, dragging, over } = useArranging(header, shown, write)
  const zone = (part: Part) =>
    cn(
      "flex items-center rounded-control",
      dragging &&
        "min-h-7 min-w-10 bg-foreground/[0.03] ring-1 ring-foreground/15",
      over === part && "bg-foreground/[0.06] ring-ring"
    )
  const draw = (part: Part) =>
    layout[part].map((id) => (
      <div
        key={id}
        data-widget={id}
        className={cn(
          "flex items-center",
          dragging === id &&
            "relative z-10 cursor-grabbing rounded-control bg-popover shadow-lift ring-1 ring-ring/60"
        )}
      >
        {nodes.get(id)}
      </div>
    ))
  return (
    // Where Banda draws the window's title bar, as on macOS (ADR 0030),
    // the bar is it: the system's window buttons sit at its start, and its
    // empty space moves the window, as a title bar's does.
    <header
      ref={header}
      className={cn(
        "relative flex h-(--bar-height) shrink-0 items-center gap-1 border-b border-(--bar-rule) px-1.5 frame:ps-[calc(var(--frame-inset)+--spacing(1.5))] frame:[-webkit-app-region:drag] frame:*:[-webkit-app-region:no-drag]",
        dragging && "cursor-grabbing select-none"
      )}
    >
      {/* The Mark stays at the left edge, as the Apple menu does, and
        opens the Banda menu at its root: Alt+Space's own action would
        focus the sidebar's Search, or fill the desk with Quick Look's
        tile where one shows. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Banda menu${words}`}
        aria-haspopup="dialog"
        title={`${keyFor("menu.open", "Banda menu")}${words}`}
        className="relative"
        onClick={() => run("menu.at")}
      >
        <BandaMark state={mark} className="size-5" />
        {/* Quiet (ADR 0098, decision 21): at the prototype's corner, or
          above the count where it shows. */}
        {quiet && (
          <BellOffIcon
            aria-hidden
            data-quiet
            className={cn(
              "absolute -right-1 size-2.5 text-muted-foreground transition-opacity duration-(--dur-fast) ease-(--ease) starting:opacity-0",
              waiting > 1 ? "-top-0.5" : "-bottom-1"
            )}
          />
        )}
        {waiting > 1 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-attention px-0.5 text-small leading-none font-semibold text-white tabular-nums"
          >
            {waiting > 9 ? "9+" : waiting}
          </span>
        )}
      </Button>
      <div data-part="left" className={zone("left")}>
        {draw("left")}
      </div>
      <div
        data-part="center"
        className={cn(
          "absolute top-1/2 left-1/2 -translate-1/2",
          zone("center")
        )}
      >
        {draw("center")}
      </div>
      <div className="ml-auto flex items-center">
        <div data-part="right" className={zone("right")}>
          {draw("right")}
        </div>
        <UpdateWidget engine={engine} />
        <LookProblems more={problems} />
        <Connection status={status} />
      </div>
    </header>
  )
}

/** Each part's ids, as drawn. */
function layoutOf(widgets: Partial<Record<Part, readonly Drawn[]>>): Layout {
  const ids = (part: Part) => (widgets[part] ?? []).map((one) => one.id)
  return { left: ids("left"), center: ids("center"), right: ids("right") }
}

/** A widget picked up with the mod: where it would go, and where the pointer
 * holds it. */
type Drag = {
  id: string
  part: Part
  index: number
  /** Released here, it goes back. */
  away: boolean
  /** Where the pointer took it, from its corner. */
  grab: { x: number; y: number }
  at: { x: number; y: number }
}

/**
 * Moving a widget with the mod (ADR 0064): a press with the mod picks it up, it
 * follows the pointer while the others make room, and a release writes
 * where it stands; `Escape`, or a release away from the bar, puts it back.
 * What it wrote stands until the look reads it back.
 */
function useArranging(
  header: RefObject<HTMLElement | null>,
  shown: Layout,
  write: (after: Layout) => void
) {
  const holdsMod = useHoldsMod()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<Layout | null>(null)
  const base = pending && !same(pending, shown) ? pending : shown
  // What it wrote stands a while, until the look reads the file back.
  useEffect(() => {
    if (!pending) return
    const late = setTimeout(() => setPending(null), 3000)
    return () => clearTimeout(late)
  }, [pending])
  const layout = drag ? moved(base, drag.id, drag.part, drag.index) : base
  // The widget held follows the pointer from the place it would take.
  useLayoutEffect(() => {
    const bar = header.current
    if (!bar || !drag) return
    const held = bar.querySelector<HTMLElement>(
      `[data-widget="${CSS.escape(drag.id)}"]`
    )
    if (!held) return
    held.style.transform = ""
    const place = held.getBoundingClientRect()
    const x = drag.at.x - drag.grab.x - place.left
    const y = drag.at.y - drag.grab.y - place.top
    held.style.transform = `translate(${x}px, ${y}px)`
    return () => {
      held.style.transform = ""
    }
  })
  useEffect(() => {
    const bar = header.current
    if (!bar) return
    const target = (id: string, x: number, y: number) => {
      const box = bar.getBoundingClientRect()
      const share = (x - box.left) / box.width
      const part: Part =
        share < 1 / 3 ? "left" : share > 2 / 3 ? "right" : "center"
      const others = base[part].filter((one) => one !== id)
      let index = others.length
      for (const [i, other] of others.entries()) {
        const at = bar
          .querySelector(`[data-widget="${CSS.escape(other)}"]`)
          ?.getBoundingClientRect()
        if (!at || at.width === 0) continue
        if (x < at.left + at.width / 2) {
          index = i
          break
        }
      }
      return { part, index, away: y > box.bottom + 48 }
    }
    const down = (event: PointerEvent) => {
      if (!holdsMod(event) || event.button !== 0) return
      const held = (event.target as Element).closest<HTMLElement>(
        "[data-widget]"
      )
      const id = held?.dataset.widget
      const part = id && PARTS.find((one) => base[one].includes(id))
      if (!held || !id || !part) return
      event.preventDefault()
      event.stopPropagation()
      bar.setPointerCapture(event.pointerId)
      const box = held.getBoundingClientRect()
      setDrag({
        id,
        part,
        index: base[part].indexOf(id),
        away: false,
        grab: { x: event.clientX - box.left, y: event.clientY - box.top },
        at: { x: event.clientX, y: event.clientY },
      })
    }
    const move = (event: PointerEvent) => {
      if (!drag) return
      const at = { x: event.clientX, y: event.clientY }
      setDrag({ ...drag, ...target(drag.id, at.x, at.y), at })
    }
    const up = (event: PointerEvent) => {
      if (!drag) return
      setDrag(null)
      // Where the pointer lets go: on a busy page the release can come
      // with the last moves, before any of them is drawn, and `drag` is
      // then a step behind it.
      const { part, index, away } = target(
        drag.id,
        event.clientX,
        event.clientY
      )
      const after = moved(base, drag.id, part, index)
      if (away || same(after, base)) return
      setPending(after)
      write(after)
    }
    const cancel = () => setDrag(null)
    // With the mod, a widget is held, not clicked.
    const click = (event: MouseEvent) => {
      if (!holdsMod(event)) return
      if (!(event.target as Element).closest("[data-widget]")) return
      event.preventDefault()
      event.stopPropagation()
    }
    const key = (event: KeyboardEvent) => {
      if (!drag || event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setDrag(null)
    }
    bar.addEventListener("pointerdown", down, { capture: true })
    bar.addEventListener("pointermove", move)
    bar.addEventListener("pointerup", up)
    bar.addEventListener("pointercancel", cancel)
    bar.addEventListener("click", click, { capture: true })
    window.addEventListener("keydown", key, { capture: true })
    return () => {
      bar.removeEventListener("pointerdown", down, { capture: true })
      bar.removeEventListener("pointermove", move)
      bar.removeEventListener("pointerup", up)
      bar.removeEventListener("pointercancel", cancel)
      bar.removeEventListener("click", click, { capture: true })
      window.removeEventListener("keydown", key, { capture: true })
    }
  }, [header, base, drag, write, holdsMod])
  return {
    layout,
    dragging: drag?.id,
    over: drag && !drag.away ? drag.part : undefined,
  }
}

/** The mark sleeps while the engine does not answer, and fails if it refused. */
function markOf(status: Status): MarkState {
  if (status.state === "open") return "rest"
  return status.state === "refused" ? "failed" : "offline"
}

/** Says nothing while the engine answers; otherwise, what is going on. */
function Connection({ status }: { status: Status }) {
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "refused"
        ? status.refusal.message
        : "Reconnecting…"
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 text-meta text-muted-foreground"
    >
      {status.state === "refused" ? (
        <span className="size-2 rounded-full bg-destructive" />
      ) : (
        <Spinner className="size-3" />
      )}
      {words}
    </div>
  )
}

/** Where a file of the look is wrong, as compilers say it. */
export function problemWords(problem: Problem): string {
  const at =
    problem.line != null ? `:${problem.line}:${problem.column ?? 1}` : ""
  return `${problem.path}${at}: ${problem.message}`
}

/**
 * Says when a file of the look is wrong (ADR 0005, decision 11): the last
 * good look stays, and this names the file and the line.
 * `banda look check` says the same in a terminal.
 */
function LookProblems({ more }: { more: readonly Problem[] }) {
  const problems = [...useLookProblems(), ...more]
  if (problems.length === 0) return null
  const words = problems.map(problemWords).join("\n")
  return (
    <div
      role="status"
      aria-label={`The look: ${words}`}
      title={`The look keeps its last good state:\n${words}`}
      className="flex items-center gap-1 px-2 text-meta text-destructive"
    >
      <TriangleAlertIcon className="size-3.5" />
      {problems[0].path.split("/").at(-1)}
    </div>
  )
}
