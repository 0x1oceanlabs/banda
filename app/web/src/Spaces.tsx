import { useState } from "react"
import type { Engine, SpaceSummary, Status } from "@bandaso/contract"
import { Button } from "@bandaso/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@bandaso/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bandaso/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bandaso/ui/components/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@bandaso/ui/components/field"
import { Input } from "@bandaso/ui/components/input"
import { Spinner } from "@bandaso/ui/components/spinner"
import { useAct } from "@bandaso/ui/hooks/use-act"
import { ChevronsUpDownIcon, FolderIcon, PlusIcon } from "lucide-react"

/** Names a new Space and creates it; `onCreated` hears the Space. */
function SpaceForm({
  engine,
  onCreated,
}: {
  engine: Engine
  onCreated: (space: SpaceSummary) => void
}) {
  const [name, setName] = useState("")
  const { busy, problem, act } = useAct()
  const ready = name.trim() !== "" && !busy
  const make = async () => {
    if (!ready) return
    const space = await act(() =>
      engine.command<SpaceSummary>("spaces.create", { name: name.trim() })
    )
    if (space) onCreated(space)
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void make()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="space-name">Name</FieldLabel>
          <Input
            id="space-name"
            autoFocus
            placeholder="Work"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {problem && <FieldError>{problem}</FieldError>}
      </FieldGroup>
      <Button type="submit" disabled={!ready} className="self-end">
        {busy && <Spinner />}
        Create Space
      </Button>
    </form>
  )
}

/** The first thing a new Person sees: one Space to make. */
export function FirstSpace({
  engine,
  onCreated,
}: {
  engine: Engine
  onCreated: (space: SpaceSummary) => void
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your first Space</CardTitle>
          <CardDescription>
            A Space is a folder on this computer where you and your Agents work.
            Everything in it is shared with them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpaceForm engine={engine} onCreated={onCreated} />
        </CardContent>
      </Card>
    </div>
  )
}

/** The window's top line: which Space, and how the engine is. */
export function TopBar({
  engine,
  status,
  spaces,
  current,
  onPick,
  onCreated,
}: {
  engine: Engine
  status: Status
  spaces: SpaceSummary[]
  current: SpaceSummary | undefined
  onPick: (space: SpaceSummary) => void
  onCreated: (space: SpaceSummary) => void
}) {
  const [creating, setCreating] = useState(false)
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      {current && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" aria-label="Space" />}
          >
            <FolderIcon />
            <span className="max-w-48 truncate">{current.name}</span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Spaces</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={current.id}
                onValueChange={(id) => {
                  const space = spaces.find((s) => s.id === id)
                  if (space) onPick(space)
                }}
              >
                {spaces.map((space) => (
                  <DropdownMenuRadioItem key={space.id} value={space.id}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{space.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {space.folder}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <PlusIcon />
              New Space…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Connection status={status} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Space</DialogTitle>
            <DialogDescription>
              A new folder for you and your Agents.
            </DialogDescription>
          </DialogHeader>
          <SpaceForm
            engine={engine}
            onCreated={(space) => {
              setCreating(false)
              onCreated(space)
            }}
          />
        </DialogContent>
      </Dialog>
    </header>
  )
}

/** Says nothing while the engine answers; otherwise, what is going on. */
function Connection({ status }: { status: Status }) {
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "lost"
        ? "Reconnecting…"
        : status.refusal.message
  return (
    <div
      role="status"
      className="ml-auto flex items-center gap-2 px-2 text-xs text-muted-foreground"
    >
      {status.state === "refused" ? (
        <span className="size-2 rounded-full bg-destructive" />
      ) : (
        <Spinner className="size-3" />
      )}
      {words}
    </div>
  )
}
