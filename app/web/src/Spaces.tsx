import { useState } from "react"
import type { Engine, SpaceSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@banda/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import { useAct } from "@banda/ui/hooks/use-act"

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
      engine.command("spaces.create", { name: name.trim() })
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

/** A dialog that names a new Space and creates it. */
export function NewSpace({
  engine,
  open,
  onOpenChange,
  onCreated,
}: {
  engine: Engine
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (space: SpaceSummary) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onOpenChange(false)
            onCreated(space)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
