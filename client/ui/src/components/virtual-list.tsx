/**
 * A long list of rows of one height, drawn only where it is scrolled to
 * (ADR 0073, decision 14): a table of a hundred thousand rows, a file's
 * bytes, a JSON's tree. A header above the rows stays as they scroll, and
 * goes sideways with them when they are wider than the list. Rows taller
 * in all than a page may be are scaled into it (`lib/virtual`).
 */
import {
  type CSSProperties,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { drawnAt, scrollFor } from "../lib/virtual"
import { cn } from "../lib/utils"

export type VirtualListHandle = {
  /** Brings row `index` into the view: to its top, its middle, or as
   * near as needs. */
  scrollTo: (index: number, align?: "start" | "center" | "nearest") => void
  /** The rows in view now, first to last. */
  shown: () => { first: number; last: number }
  /** Gives the list the keys. */
  focus: () => void
}

export type VirtualListProps = {
  count: number
  /** Each row's height, in px. */
  rowHeight: number
  /** Row `index`, placed by `style`, which it must take; the list keys
   * it. */
  row: (index: number, style: CSSProperties) => ReactNode
  /** What stays above the rows as they scroll. */
  header?: ReactNode
  /** How wide the rows are, in px or as CSS, when wider than the list;
   * it scrolls sideways then. */
  width?: number | string
  /** How many rows are drawn past each end of the view. */
  overscan?: number
  /** Says the rows drawn, first to last, each time they change. */
  onRange?: (first: number, last: number) => void
  ref?: Ref<VirtualListHandle>
} & Omit<HTMLAttributes<HTMLDivElement>, "children">

export function VirtualList({
  count,
  rowHeight,
  row,
  header,
  width,
  overscan,
  onRange,
  ref,
  className,
  onScroll,
  ...rest
}: VirtualListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [size, setSize] = useState({ view: 0, header: 0 })

  // The view's height and the header's, as they change.
  useLayoutEffect(() => {
    const list = scroller.current
    if (!list) return
    const measure = () => {
      setSize((was) => {
        const now = {
          view: list.clientHeight,
          header: head.current?.offsetHeight ?? 0,
        }
        return was.view === now.view && was.header === now.header ? was : now
      })
      setScroll(list.scrollTop)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(list)
    if (head.current) watch.observe(head.current)
    return () => watch.disconnect()
  }, [])

  const rows = {
    count,
    row: rowHeight,
    view: Math.max(0, size.view - size.header),
    overscan,
  }
  const drawn = drawnAt(rows, scroll)
  const range = useRef(rows)
  useEffect(() => {
    range.current = rows
  })

  useEffect(() => {
    if (drawn.last >= drawn.first) onRange?.(drawn.first, drawn.last)
  }, [drawn.first, drawn.last, onRange])

  useImperativeHandle(
    ref,
    () => ({
      scrollTo: (index, align = "nearest") => {
        const list = scroller.current
        if (!list) return
        const to = scrollFor(range.current, index, align, list.scrollTop)
        list.scrollTop = to
        setScroll(list.scrollTop)
      },
      shown: () => {
        const list = scroller.current
        const { first, last } = drawnAt(
          { ...range.current, overscan: 0 },
          list?.scrollTop ?? 0
        )
        return { first, last }
      },
      focus: () => scroller.current?.focus(),
    }),
    []
  )

  const indices: number[] = []
  for (let index = drawn.first; index <= drawn.last; index++)
    indices.push(index)

  return (
    <div
      ref={scroller}
      className={cn("relative min-h-0 overflow-auto", className)}
      onScroll={(event) => {
        // Drawn again only when other rows show, or the rows are scaled
        // and placed where the view is.
        const to = event.currentTarget.scrollTop
        const next = drawnAt(rows, to)
        if (
          drawn.height < count * rowHeight ||
          next.first !== drawn.first ||
          next.last !== drawn.last
        )
          setScroll(to)
        onScroll?.(event)
      }}
      {...rest}
    >
      <div style={{ width: width ?? "100%", minWidth: "100%" }}>
        {header !== undefined && (
          <div ref={head} className="sticky top-0 z-10">
            {header}
          </div>
        )}
        <div className="relative" style={{ height: drawn.height }}>
          {indices.map((index) => (
            <Fragment key={index}>
              {row(index, {
                position: "absolute",
                top: drawn.top(index),
                left: 0,
                right: 0,
                height: rowHeight,
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
