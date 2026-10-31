import { useCallback, useState } from "react"
import type { Engine, SpaceSummary } from "@bandaso/contract"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { useModules, useStatus } from "@bandaso/ui/hooks/use-status"
import { Desk } from "./Desk"
import { FirstSpace, TopBar } from "./Spaces"

const CURRENT = "bandaso.space"

/** The window: one Space's Desk under the top bar. */
export function App({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const modules = useModules(engine)
  const listed = useRead(
    useCallback(() => engine.call<SpaceSummary[]>("spaces.list"), [engine])
  )
  // Spaces made in this window, until the list is read again.
  const [created, setCreated] = useState<SpaceSummary[]>([])
  const [picked, setPicked] = useState(() => remembered())

  const spaces =
    listed.state === "ready"
      ? [
          ...listed.value,
          ...created.filter((c) => !listed.value.some((s) => s.id === c.id)),
        ]
      : []
  const pick = (space: SpaceSummary) => {
    setPicked(space.id)
    remember(space.id)
  }
  const onCreated = (space: SpaceSummary) => {
    setCreated((created) => [...created, space])
    pick(space)
  }
  const current = spaces.find((s) => s.id === picked) ?? spaces[0]

  return (
    <div className="flex h-svh flex-col bg-muted/40 text-foreground">
      <TopBar
        engine={engine}
        status={status}
        spaces={spaces}
        current={current}
        onPick={pick}
        onCreated={onCreated}
      />
      <main className="min-h-0 flex-1">
        {listed.state === "loading" ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : listed.state === "refused" ? (
          <p role="alert" className="p-6 text-sm text-muted-foreground">
            {listed.refusal.message}
          </p>
        ) : current ? (
          <Desk
            key={current.id}
            engine={engine}
            space={current}
            modules={modules}
          />
        ) : (
          <FirstSpace engine={engine} onCreated={onCreated} />
        )}
      </main>
    </div>
  )
}

function remembered(): string | null {
  try {
    return localStorage.getItem(CURRENT)
  } catch {
    return null
  }
}

function remember(space: string): void {
  try {
    localStorage.setItem(CURRENT, space)
  } catch {
    // Which Space comes first is a convenience.
  }
}
