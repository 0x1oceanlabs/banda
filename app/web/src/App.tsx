import { useCallback, useState } from "react"
import type { Engine, SpaceSummary } from "@bandaso/contract"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { useModules, useStatus } from "@bandaso/ui/hooks/use-status"
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
    useCallback(() => engine.call<SpaceSummary[]>("spaces.list"), [engine])
  )
  // Spaces made in this window, until the list is read again.
  const [created, setCreated] = useState<SpaceSummary[]>([])
  const onCreated = useCallback(
    (space: SpaceSummary) => setCreated((created) => [...created, space]),
    []
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
  const spaces = [
    ...listed.value,
    ...created.filter((c) => !listed.value.some((s) => s.id === c.id)),
  ]
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
