/**
 * A markdown task's box, which the host of the markdown may let the
 * Person tick: Files writes the task's line (ADR 0073, decision 8). Where
 * no host does, as in a reply, the box only shows.
 */
import { createContext, use, type ComponentProps, type ReactNode } from "react"

/** Ticks the markdown's task `nth`, from 0 in the order they show, or
 * unticks it; `of` is how many boxes show, so a host that counts its
 * tasks otherwise writes nothing. */
export type Tick = (nth: number, done: boolean, of: number) => void

const Ticks = createContext<Tick | null>(null)

/** Lets the Person tick the task boxes of the markdown inside it. */
export function MarkdownTasks({
  tick,
  children,
}: {
  tick: Tick | null
  children: ReactNode
}) {
  return <Ticks value={tick}>{children}</Ticks>
}

/** An input in markdown: a task's box, which ticks where its host lets
 * it. */
export function MarkdownInput({
  type,
  checked,
}: Pick<ComponentProps<"input">, "type" | "checked">) {
  const tick = use(Ticks)
  if (type !== "checkbox" || !tick)
    return <input type={type} checked={checked} disabled readOnly />
  return (
    <input
      type="checkbox"
      checked={checked}
      className="cursor-pointer accent-primary"
      onChange={(event) => {
        const box = event.currentTarget
        const markdown = box.closest('[data-slot="markdown"]')
        const boxes = [
          ...(markdown?.querySelectorAll('input[type="checkbox"]') ?? []),
        ]
        const nth = boxes.indexOf(box)
        if (nth !== -1) tick(nth, box.checked, boxes.length)
      }}
    />
  )
}
