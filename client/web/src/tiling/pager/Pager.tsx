/**
 * The Pager, drawn (`pager.ts` says what it takes and gives): a button per
 * cell, and the mark on the one on screen. What a cell shows is decided
 * there; here each `Face` has its drawing. The cells come, go and mark the
 * one on screen on the look's `workspace` move, with the screen
 * (`motion.ts`).
 */
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import { PlusIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef } from "react"
import { PagerMotion } from "./motion"
import type { Cell, Face } from "./pager"

/** How wide each cell is drawn, in rem: the mark's 1.5rem and a hair each
 * side. */
const WIDTH = 1.625

export function Pager({
  cells,
  onPick,
}: {
  cells: readonly Cell[]
  /** A click on the cell of the workspace at `index`. */
  onPick: (index: number) => void
}) {
  const keyFor = useKeyLabel()
  const nav = useRef<HTMLElement>(null)
  const mark = useRef<HTMLSpanElement>(null)
  const motion = useRef<PagerMotion>(null)
  motion.current ??= new PagerMotion()
  const sized = cells.map((cell) => ({ id: cell.id, width: WIDTH }))
  const left = cells.findIndex((cell) => cell.here) * WIDTH
  useLayoutEffect(() => {
    motion.current?.sync(nav.current, sized, mark.current, left)
  })
  useEffect(() => () => motion.current?.stop(), [])
  return (
    <nav
      ref={nav}
      aria-label="Workspaces"
      className="relative flex items-center"
    >
      <span
        ref={mark}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-[0.0625rem] -mt-3 size-6 rounded-control bg-muted"
      />
      {cells.map((cell) => (
        <button
          key={cell.id}
          data-workspace={cell.id}
          type="button"
          aria-current={cell.here || undefined}
          aria-label={cell.name}
          title={`${cell.whose ? `${cell.whose}: ` : ""}${keyFor(cell.action, cell.name)}`}
          className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-control text-meta text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:font-medium aria-[current]:text-foreground"
          onClick={() => onPick(cell.index)}
        >
          <Shown face={cell.face} />
        </button>
      ))}
    </nav>
  )
}

/** What a cell shows, by its `Face`. */
function Shown({ face }: { face: Face }) {
  switch (face.kind) {
    case "number":
      return face.number
    case "sign":
      return (
        <ProjectSign
          project={face.project}
          className={cn(face.faint && "opacity-45")}
        />
      )
    case "new":
      return <PlusIcon className="size-3.5 shrink-0" />
  }
}
