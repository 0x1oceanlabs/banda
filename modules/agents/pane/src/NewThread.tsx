/** Where a new Thread starts: its Space and its Harness (ADR 0006). */
import { useCallback } from "react"
import type { Engine, SpaceId, SpaceSummary } from "@bandaso/contract"
import type { HarnessView } from "@bandaso/contract/agents"
import { Button } from "@bandaso/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@bandaso/ui/components/dropdown-menu"
import { useRead } from "@bandaso/ui/hooks/use-read"
import { BotIcon, ChevronDownIcon, FolderIcon } from "lucide-react"

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
      {spaces.length > 1 && (
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

function Pick({
  what,
  icon,
  value,
  choices,
  disabled,
  onChange,
}: {
  what: string
  icon: React.ReactNode
  value: string
  choices: { id: string; name: string; about?: string }[]
  disabled: boolean
  onChange: (id: string) => void
}) {
  const now = choices.find((choice) => choice.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`${what}: ${now?.name ?? value}`}
          />
        }
      >
        {icon}
        {now?.name ?? value}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{what}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.id}
                value={choice.id}
                closeOnClick
              >
                <span className="flex flex-col">
                  <span>{choice.name}</span>
                  {choice.about && (
                    <span className="text-xs text-muted-foreground">
                      {choice.about}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
