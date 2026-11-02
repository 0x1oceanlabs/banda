import { useCallback, useEffect, useRef, useState } from "react"
import type { Engine, SpaceSummary } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { useInFront } from "@banda/ui/hooks/use-in-front"
import { useRead } from "@banda/ui/hooks/use-read"
import { useModules, useStatus } from "@banda/ui/hooks/use-status"
import { sameSpaces, shownSpaces } from "@banda/ui/lib/spaces"
import { Shell } from "./shell/Shell"
import { FirstSpace } from "./Spaces"

/**
 * The page: the engine's Spaces, then the window over them; a first Space
 * to make when there is none.
 */
export function App({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const modules = useModules(engine)
  const listed = useRead(
    useCallback(() => engine.call("spaces.list", {}), [engine])
  )
  // The list read again as the window comes to the front, and once a
  // Space is added: one added or changed elsewhere, as by `banda space
  // add`, shows then. A Space added here shows at once, as the engine
  // answered it. A list that says what it said keeps the window as it is.
  const [list, setList] = useState<SpaceSummary[]>()
  const reread = useCallback(() => {
    engine.call("spaces.list", {}).then(
      (spaces) =>
        setList((was) => (was && sameSpaces(was, spaces) ? was : spaces)),
      () => undefined
    )
  }, [engine])
  const front = useInFront()
  const started = useRef(false)
  useEffect(() => {
    // The first read is `listed`'s.
    if (front && started.current) reread()
    started.current = true
  }, [front, reread])
  const first = listed.state === "ready" ? listed.value : undefined
  const onCreated = useCallback(
    (space: SpaceSummary) => {
      setList((was) => [
        ...(was ?? first ?? []).filter((one) => one.id !== space.id),
        space,
      ])
      reread()
    },
    [reread, first]
  )

  if (listed.state === "loading") {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (listed.state === "refused") {
    return (
      <p role="alert" className="p-6 text-sm text-muted-foreground">
        {listed.refusal.message}
      </p>
    )
  }
  const spaces = shownSpaces(list ?? listed.value)
  // The first Space is home until Banda makes a default one (ADR 0006).
  const home = spaces[0]
  if (!home) {
    return (
      <div className="h-svh bg-muted/40">
        <FirstSpace engine={engine} onCreated={onCreated} />
      </div>
    )
  }
  return (
    <Shell
      engine={engine}
      status={status}
      modules={modules}
      spaces={spaces}
      home={home.id}
      onCreated={onCreated}
    />
  )
}
