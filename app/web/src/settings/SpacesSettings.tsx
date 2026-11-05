/**
 * The Spaces section (ADR 0026, decision 5), in T3 Code's words: a
 * Space's name, whether it comes first, whether it is hidden, and its
 * removal. They are the engine's, not a file's, so the section calls the
 * engine, and tells the window a Space changed. Archived Spaces show only
 * here, where they can come back.
 */
import { useState } from "react"
import type { Engine, SpaceSummary, UpdateSpace } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@banda/ui/components/select"
import { Spinner } from "@banda/ui/components/spinner"
import { Switch } from "@banda/ui/components/switch"
import { useAct } from "@banda/ui/hooks/use-act"
import { useSpaces } from "@banda/ui/hooks/use-spaces"
import { removeSpace, updateSpace } from "@banda/ui/lib/spaces"
import { cn } from "@banda/ui/lib/utils"
import { FolderSearchIcon, Trash2Icon } from "lucide-react"
import { LOCATE, locateRoute } from "../menu/menu"
import { AsideRow } from "../safe/AsidePill"
import { Field, Group, RowFrame, Rows } from "./SettingRow"

/** The Space a removal asks about, and how many Threads go with it, if
 * the agents module said. */
type Removing = { space: SpaceSummary; threads?: number }

type Props = {
  engine: Engine
  /** The Space a link names: `spaces/<id>`. */
  lit?: string
}

/** The Spaces, and the workspaces set aside while some are (ADR 0039). */
export function SpacesSettings(props: Props) {
  return (
    <>
      <AsideRow engine={props.engine} />
      <Space {...props} />
    </>
  )
}

function Space({ engine, lit }: Props) {
  // Every Space, the archived too, as the window's other lists read them.
  const { listed } = useSpaces(engine)
  // The Space picked here, until a link names another.
  const [pick, setPick] = useState<{ lit?: string; id: string }>()
  const picked = pick && pick.lit === lit ? pick.id : lit
  const { busy, problem, act } = useAct()
  const [removing, setRemoving] = useState<Removing>()

  if (listed.state === "loading") return <Spinner />
  if (listed.state === "refused")
    return <p className="text-sm text-destructive">{listed.refusal.message}</p>
  const spaces = listed.value
  const space = spaces.find((one) => one.id === picked) ?? spaces[0]
  if (!space)
    return <p className="text-sm text-muted-foreground">No Projects yet.</p>

  const change = (how: Omit<UpdateSpace, "space">) =>
    void act(() => updateSpace(engine, { space: space.id, ...how }))
  // The Threads that go with it are the agents module's.
  const ask = async () => {
    const threads = await engine
      .call("agents.threads", {}, { space: space.id })
      .then(
        (list) => list.threads.length,
        () => undefined
      )
    setRemoving({ space, threads })
  }
  const remove = () => {
    if (!removing) return
    setRemoving(undefined)
    void act(() => removeSpace(engine, removing.space.id))
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Project</span>
        <Select
          value={space.id}
          onValueChange={(id) => setPick({ lit, id: id as string })}
        >
          <SelectTrigger aria-label="Space" className="min-w-48">
            <SelectValue>
              {(id: string) => nameOf(spaces.find((one) => one.id === id))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {spaces.map((one) => (
              <SelectItem key={one.id} value={one.id}>
                {nameOf(one)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          className={cn(
            "min-w-0 truncate font-mono text-xs text-muted-foreground",
            space.missing && "text-attention line-through"
          )}
          title={space.folder}
        >
          {space.folder}
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <Rows>
        {space.missing && (
          <RowFrame
            dataKey="folder"
            title="Folder is missing"
            about="Its Threads open again once you locate the folder its work is in now."
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.banda?.menu.open(locateRoute(space.id))}
            >
              <FolderSearchIcon />
              {LOCATE}
            </Button>
          </RowFrame>
        )}
        <RowFrame
          dataKey="name"
          title="Name"
          about="The Project's name in the sidebar and the Project pickers."
        >
          <Field
            label="Project name"
            value={space.name}
            onCommit={(name) => change({ name: name.trim() })}
          />
        </RowFrame>
        <RowFrame
          dataKey="pin"
          title="Pin"
          about="Pinned Projects come first in Project pickers."
        >
          <Switch
            label="Pin Project"
            on={space.pinned}
            onChange={(pinned) => change({ pinned })}
          />
        </RowFrame>
        <RowFrame
          dataKey="archive"
          title="Archive"
          about={
            space.archived
              ? "Hidden from Project pickers. Threads and files are kept."
              : "Hides the Project from Project pickers. Threads and files are kept."
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => change({ archived: !space.archived })}
          >
            {space.archived ? "Unarchive" : "Archive"}
          </Button>
        </RowFrame>
      </Rows>
      <Group title="Danger">
        <RowFrame
          dataKey="remove"
          title="Remove Project"
          about="Deletes the Project entry and its Threads. Files on disk are not touched."
        >
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void ask()}
          >
            <Trash2Icon />
            Remove Project
          </Button>
        </RowFrame>
      </Group>
      <Dialog
        open={removing !== undefined}
        onOpenChange={(open) => !open && setRemoving(undefined)}
      >
        {removing && (
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{questionOf(removing)}</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {removing.space.folder}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p>
                This removes only the Project entries, not the files on disk.
              </p>
              <p>This action cannot be undone.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemoving(undefined)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={remove}>
                Remove Project
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

/** A Space's name in the picker; an archived one says so. */
function nameOf(space: SpaceSummary | undefined): string {
  if (!space) return ""
  return space.archived ? `${space.name} (archived)` : space.name
}

/** What a removal asks, as T3 Code does. */
function questionOf({ space, threads }: Removing): string {
  const what =
    threads === undefined
      ? "its Threads"
      : `its ${threads} ${threads === 1 ? "Thread" : "Threads"}`
  return `Remove Project "${space.name}" and delete ${what}?`
}
