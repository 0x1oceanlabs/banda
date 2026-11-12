import { Fragment } from "react"
import type { SearchField } from "./Header"
import {
  completed,
  type Filter,
  FILTERS,
  filterOf,
  fold,
  typing,
} from "./search"

/** The hint's id, which describes Search while it shows. */
export const HINT = "sb-search-hint"

/** What a filter takes, said where the list has none to offer. */
const NONE: Readonly<Record<Filter, string>> = {
  is: "where it stands",
  in: "a Project",
  on: "a machine",
  by: "a Harness",
}

/**
 * Search's hint (ADR 0098, decision 17): the filters, each with what it
 * takes, under an empty field; as one is typed, that one alone, with the
 * values that hold what follows its colon. A click on a filter or a value
 * writes it into the field, which keeps the focus; the keys stay the
 * list's, so the hint is no stop of its own.
 */
export function SearchHint({
  search,
}: {
  search: Pick<SearchField, "text" | "say" | "values">
}) {
  const { text, say, values } = search
  const now = typing(text)
  const after = fold(filterOf(text.split(/\s+/).at(-1) ?? "")?.value ?? "")
  const rows = (now ? [now] : FILTERS).map(
    (filter) =>
      [
        filter,
        values[filter].filter((value) => fold(value).includes(after)),
      ] as const
  )
  return (
    <div
      id={HINT}
      // A click in it leaves the focus in Search.
      onMouseDown={(event) => event.preventDefault()}
      className="absolute inset-x-2 top-full z-float -mt-0.5 rounded-card bg-popover p-1 text-popover-foreground shadow-float ring-1 ring-foreground/10"
    >
      <div className="px-2 py-1 text-meta text-muted-foreground">Filters</div>
      {rows.map(([filter, offered]) => (
        <div
          key={filter}
          className="flex min-w-0 items-baseline gap-2 px-2 py-1 text-ui"
        >
          <button
            type="button"
            tabIndex={-1}
            onClick={() => say(completed(text, filter))}
            className="shrink-0 font-mono text-meta text-foreground hover:underline"
          >
            {filter}:
          </button>
          <span className="line-clamp-2 min-w-0 text-muted-foreground">
            {offered.length === 0
              ? NONE[filter]
              : offered.map((value, at) => (
                  <Fragment key={value}>
                    {at > 0 && " · "}
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => say(completed(text, filter, value))}
                      className="hover:text-foreground"
                    >
                      {value}
                    </button>
                  </Fragment>
                ))}
          </span>
        </div>
      ))}
    </div>
  )
}
