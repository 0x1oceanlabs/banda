/** Where a new Thread starts: its Space and its Harness (ADR 0006). */
import { useCallback } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@bandaso/contract"
import type { HarnessView } from "@bandaso/contract/agents"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { BotIcon, FolderIcon } from "lucide-react"
import { Pick } from "./ThreadSettings"

/**
 * The Space and the Harness of a Thread not yet started. A Person changes
 * them until the first message; after it, they are the Thread's for good.
 */
export function NewThreadBar({
  engine,
  space,
  harness,
  harnesses,
  disabled,
  onSpace,
  onHarness,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  harnesses: HarnessView[]
  disabled: boolean
  onSpace: (space: SpaceId) => void
  onHarness: (harness: string) => void
}) {
  const spaces = useSpaces(engine)
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {spaces.length > 0 && (
        <Pick
          what="Space"
          icon={<FolderIcon data-icon="inline-start" />}
          value={space}
          choices={spaces.map((space) => ({
            id: space.id,
            name: space.name,
            about: space.folder,
          }))}
          disabled={disabled}
          onChange={(id) => onSpace(id as SpaceId)}
        />
      )}
      {harnesses.length > 0 && (
        <Pick
          what="Harness"
          icon={<BotIcon data-icon="inline-start" />}
          value={harness}
          choices={harnesses.map((harness) => ({
            id: harness.id,
            name: harness.name,
          }))}
          disabled={disabled}
          onChange={onHarness}
        />
      )}
    </div>
  )
}

function useSpaces(engine: Engine): SpaceSummary[] {
  const read = useRead(
    useCallback(() => engine.call<SpaceSummary[]>("spaces.list"), [engine])
  )
  return read.state === "ready" ? read.value : NONE
}

const NONE: SpaceSummary[] = []
