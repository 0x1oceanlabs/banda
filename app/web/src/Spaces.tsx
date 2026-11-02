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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@banda/ui/components/field"
import { Input } from "@banda/ui/components/input"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Suggestion,
  SuggestionList,
  Suggestions,
} from "@banda/ui/components/suggestions"
import { useAct } from "@banda/ui/hooks/use-act"
import { CornerLeftUpIcon, FolderIcon } from "lucide-react"
import { PATH_PLACEHOLDER, useBrowsed } from "./menu/browse"
import { folderRows, SOURCE_ORDER, SOURCES, type Source } from "./menu/menu"

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

/** Adds a folder on disk as a Space, as the Banda menu's "Local folder"
 * does: the path, with the folder above and those that fit it below;
 * Tab takes the first that fits. */
function FolderForm({
  engine,
  onCreated,
}: {
  engine: Engine
  onCreated: (space: SpaceSummary) => void
}) {
  const [path, setPath] = useState("~/")
  const { busy, problem, act } = useAct()
  const typed = path.trim()
  const browsed = useBrowsed(engine, typed)
  const { create, folders } = folderRows(typed, browsed)
  const ready = typed !== "" && !busy
  const add = async () => {
    if (!ready) return
    const space = await act(() =>
      engine.command("spaces.add", { folder: typed, create })
    )
    if (space) onCreated(space)
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="space-folder">Folder</FieldLabel>
          <Input
            id="space-folder"
            autoFocus
            placeholder={PATH_PLACEHOLDER}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              const fits = folders.find((folder) => !folder.up)
              if (event.key !== "Tab" || !fits) return
              event.preventDefault()
              setPath(fits.path)
            }}
          />
          {folders.length > 0 && (
            <Suggestions className="shadow-none">
              <SuggestionList aria-label="Folders">
                {folders.map((folder) => {
                  const Icon = folder.up ? CornerLeftUpIcon : FolderIcon
                  return (
                    <Suggestion
                      key={folder.id}
                      onClick={() => setPath(folder.path)}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{folder.name}</span>
                    </Suggestion>
                  )
                })}
              </SuggestionList>
            </Suggestions>
          )}
        </Field>
        {problem && <FieldError>{problem}</FieldError>}
      </FieldGroup>
      <Button type="submit" disabled={!ready} className="self-end">
        {busy && <Spinner />}
        {create ? "Create & Add" : "Add"}
      </Button>
    </form>
  )
}

/** The first thing a new Person sees: a Space to make, or a folder with
 * their work in it to add. */
export function FirstSpace({
  engine,
  onCreated,
}: {
  engine: Engine
  onCreated: (space: SpaceSummary) => void
}) {
  const [source, setSource] = useState<Source>("new")
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
        <CardContent className="flex flex-col gap-4">
          <div role="tablist" className="flex gap-1">
            {SOURCE_ORDER.map((one) => (
              <Button
                key={one}
                role="tab"
                aria-selected={source === one}
                variant={source === one ? "secondary" : "ghost"}
                size="sm"
                title={SOURCES[one].about}
                onClick={() => setSource(one)}
              >
                {SOURCES[one].title}
              </Button>
            ))}
          </div>
          {source === "new" ? (
            <SpaceForm engine={engine} onCreated={onCreated} />
          ) : (
            <FolderForm engine={engine} onCreated={onCreated} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
