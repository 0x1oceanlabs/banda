import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Engine, SpaceSummary } from "@banda/contract"
import { useInFront } from "./use-in-front"
import { type Read, useRead } from "./use-read"
import {
  onSpacesChanged,
  sameSpaces,
  spacesChanged,
} from "@banda/ui/lib/spaces"

/**
 * Every Space, the archived too (ADR 0026). Read once, then again as the
 * window comes to the front, so one added or changed elsewhere, as by
 * `banda space add`, shows then; and again once one is changed here
 * (`spacesChanged`). A list that says what it said keeps the one before.
 * `put` shows a Space the engine just answered at once, and tells the
 * window's other lists.
 */
export function useSpaces(engine: Engine): {
  listed: Read<SpaceSummary[]>
  put: (space: SpaceSummary) => void
} {
  const first = useRead(
    useCallback(() => engine.call("spaces.list", {}), [engine])
  )
  const [list, setList] = useState<SpaceSummary[]>()
  const reread = useCallback(() => {
    engine.call("spaces.list", {}).then(
      (spaces) =>
        setList((was) => (was && sameSpaces(was, spaces) ? was : spaces)),
      () => undefined
    )
  }, [engine])
  useEffect(() => onSpacesChanged(reread), [reread])
  const front = useInFront()
  const started = useRef(false)
  useEffect(() => {
    // The first read is `first`'s.
    if (front && started.current) reread()
    started.current = true
  }, [front, reread])
  const read = first.state === "ready" ? first.value : undefined
  const put = useCallback(
    (space: SpaceSummary) => {
      setList((was) => [
        ...(was ?? read ?? []).filter((one) => one.id !== space.id),
        space,
      ])
      spacesChanged()
    },
    [read]
  )
  const spaces = list ?? read
  const listed = useMemo<Read<SpaceSummary[]>>(
    () => (spaces ? { state: "ready", value: spaces } : first),
    [spaces, first]
  )
  return { listed, put }
}
