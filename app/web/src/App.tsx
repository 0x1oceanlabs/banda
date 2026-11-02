import type { Engine } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import { useModules, useStatus } from "@banda/ui/hooks/use-status"
import { shownSpaces } from "@banda/ui/lib/spaces"
import { Shell } from "./shell/Shell"
import { FirstSpace } from "./Spaces"

/**
 * The page: the engine's Spaces, then the window over them; a first Space
 * to make when there is none.
 */
export function App({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const modules = useModules(engine)
  // A Space added here shows at once, as the engine answered it.
  const { listed, put: onCreated } = useSpaces(engine)

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
  const spaces = shownSpaces(listed.value)
  // The first Space is home until Banda makes a default one (ADR 0006);
  // one whose folder is missing opens nothing.
  const home = spaces.find((space) => !space.missing)
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
