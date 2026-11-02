/** Where a new Thread starts: its Space and its Harness (ADR 0006). */
import { useMemo } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import type { HarnessView } from "@banda/contract/agents"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import { openSpaces, shownSpaces } from "@banda/ui/lib/spaces"
import { BotIcon, FolderIcon, FolderPlusIcon } from "lucide-react"
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
  onAddSpace,
}: {
  engine: Engine
  space: SpaceId
  harness: string
  harnesses: HarnessView[]
  disabled: boolean
  onSpace: (space: SpaceId) => void
  onHarness: (harness: string) => void
  /** Opens "Add Space" in the Banda menu (ADR 0026), from the Space list. */
  onAddSpace?: () => void
}) {
  const spaces = useShownSpaces(engine)
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
          more={
            onAddSpace && {
              title: "Add Space",
              icon: <FolderPlusIcon />,
              run: onAddSpace,
            }
          }
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

function useShownSpaces(engine: Engine): SpaceSummary[] {
  const { listed } = useSpaces(engine)
  // As the window lists them: pinned first, archived ones not at all;
  // nor one whose folder is missing, where no Thread starts.
  return useMemo(
    () =>
      listed.state === "ready" ? openSpaces(shownSpaces(listed.value)) : NONE,
    [listed]
  )
}

const NONE: SpaceSummary[] = []
