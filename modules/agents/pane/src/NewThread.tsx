/** Where a new Thread starts: its Space (ADR 0006). Its Harness is chosen
 * with its model, in the model picker (ADR 0031, decision 6). */
import { useMemo } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import { useMachine } from "@banda/ui/hooks/use-status"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import { openSpaces, shownSpaces } from "@banda/ui/lib/spaces"
import { FolderIcon, FolderPlusIcon } from "lucide-react"
import { Pick } from "./ThreadSettings"

/**
 * The Space of a Thread not yet started. A Person changes it until the
 * first message; after it, it is the Thread's for good.
 */
export function NewThreadBar({
  engine,
  space,
  disabled,
  onSpace,
  onAddSpace,
}: {
  engine: Engine
  space: SpaceId
  disabled: boolean
  onSpace: (space: SpaceId) => void
  /** Opens "Add Space" in the Banda menu (ADR 0026), from the Space list. */
  onAddSpace?: () => void
}) {
  const spaces = useShownSpaces(engine)
  const machine = useMachine(engine)
  return (
    // In meta words, its icon in line with the composer's text above it.
    <div className="flex min-w-0 items-center gap-0.5 px-2.5 text-muted-foreground">
      {machine && (
        <Pick
          what="Project"
          icon={<FolderIcon data-icon="inline-start" />}
          value={spaces.some((s) => s.id === space) ? space : machine}
          choices={[
            {
              id: machine,
              name: "No Project",
              about: "A new Thread with its own folder",
            },
            ...spaces.map((space) => ({
              id: space.id,
              name: space.name,
              about: space.folder,
            })),
          ]}
          disabled={disabled}
          onChange={(id) => onSpace(id as SpaceId)}
          more={
            onAddSpace && {
              title: "Add Project",
              icon: <FolderPlusIcon />,
              run: onAddSpace,
            }
          }
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
