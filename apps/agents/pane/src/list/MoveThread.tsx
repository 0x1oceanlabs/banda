/**
 * "Move Thread": the dialog the Thread menu's "Move to Project…" opens
 * (ADR 0098, decision 14; ADR 0116, decisions 1 and 7). It lists the
 * Projects of every machine the Window reaches, the Thread's own machine
 * first, and moves the Thread to the one picked.
 *
 * To a Project of its own machine it moves at once, as before. To
 * another machine it says first what goes and what stays, as both
 * folders say it (`look`), and takes a message for the Agent there, sent
 * once the Thread arrived, so the work goes on and this device may
 * close. The move goes on after the dialog closed (`moveTo`).
 */
import type { Named, ProjectId } from "@banda/contract"
import { type Machine, useMachines } from "@banda/core/react"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { toast } from "@banda/ui/components/sonner"
import { Spinner } from "@banda/ui/components/spinner"
import { Textarea } from "@banda/ui/components/textarea"
import { cn } from "@banda/ui/lib/utils"
import { problem } from "@banda/ui/lib/words"
import {
  itemOf,
  type TopPart,
  type TopProps,
  type WindowApi,
} from "@banda/ui/module"
import { CircleAlertIcon, GitBranchIcon } from "lucide-react"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import type { End, Looked } from "./carry"
import { look } from "./carry"
import {
  type Asked,
  busy,
  MOVE,
  moveBeside,
  moveTo,
  type Place,
  placesOf,
} from "./moving"

/** This machine before its engine says its name. */
const THIS_MACHINE: Named = { name: "This machine", icon: "desktop" }

/** The dialog, for the Thread its args name: none when that is no Thread
 * the Window lists, as one that left meanwhile. */
function MovingThread({ window, args, onClose }: TopProps) {
  const at = itemOf(window, args)
  const listed = useMachines() ?? window.machines()
  if (!at?.listed.pane.kind.startsWith("agents.")) return null
  // Each machine by its name: this one's as its engine says it.
  const named = new Map(window.machines().map((one) => [one.host, one.named]))
  const machines = listed.map((one) => ({
    ...one,
    named: one.named ?? named.get(one.host) ?? THIS_MACHINE,
  }))
  return (
    <MoveThread
      window={window}
      asked={at}
      to={typeof args.to === "string" ? (args.to as ProjectId) : undefined}
      machines={machines}
      onClose={onClose}
    />
  )
}

/** "Move Thread", in the Window's Top layer. */
export const moveThread: TopPart = { id: MOVE, Part: MovingThread }

/** A machine, named. */
type NamedMachine = Machine & { named: Named }

/** What the two folders said of a move to a Place, or that they are
 * asked now, or why they could not be. */
type Said = Looked | { kind: "asking" } | { kind: "failed"; why: string }

function MoveThread({
  window,
  asked,
  to: first,
  machines,
  onClose,
}: {
  window: WindowApi
  asked: Asked
  to?: ProjectId
  machines: readonly NamedMachine[]
  onClose: () => void
}) {
  const { project, listed } = asked
  const groups = placesOf(machines, project, listed.host)
  const all = groups.flatMap((group) => group.places)
  const [picked, setPicked] = useState<Place | undefined>(() =>
    all.find((place) => place.project === first)
  )
  const [message, setMessage] = useState("")
  // What the folders said, of the Project they said it of.
  const [heard, setHeard] = useState<{ of: ProjectId; said: Said }>()
  const list = useRef<HTMLDivElement>(null)
  // The Project picked has the focus as the dialog opens, else the first.
  const start = useRef<HTMLButtonElement>(null)
  const label = useId()

  const nameOf = (host: string | undefined) =>
    machines.find((machine) => machine.host === host)?.named.name ??
    THIS_MACHINE.name
  const own = machines
    .find((machine) => machine.host === listed.host)
    ?.projects.find((one) => one.id === project)
  const across = picked !== undefined && picked.host !== listed.host
  // A machine the Window does not reach now refuses here, in its words.
  const ends = (to: Place): { from: End; to: End } => ({
    from: {
      engine: window.sessionOf(project, listed.pane),
      project,
      machine: nameOf(listed.host),
      name: own?.name ?? "its Project",
    },
    to: {
      engine: window.sessionOf(to.project),
      project: to.project,
      machine: nameOf(to.host),
      name: to.name,
    },
  })

  // Both folders are asked as a Project on another machine is picked.
  const to = across ? picked : undefined
  useEffect(() => {
    if (!to) return
    let stale = false
    const hear = (said: Said) => !stale && setHeard({ of: to.project, said })
    Promise.resolve()
      .then(() => look(ends(to)))
      .then(hear, (error: unknown) =>
        hear({ kind: "failed", why: problem(error, "Move") })
      )
    return () => {
      stale = true
    }
    // Asked again only as another Project is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to?.project])
  const said: Said =
    heard && heard.of === to?.project ? heard.said : { kind: "asking" }

  const ready =
    picked !== undefined &&
    (!across || said.kind === "goes" || said.kind === "stays")
  const move = () => {
    if (!picked || !ready) return
    onClose()
    try {
      const both = ends(picked)
      if (!across) void moveBeside(window, both.from.engine, asked, picked)
      // Asked again as it moves: what the folders say may have changed
      // while a Thread at work ended its turn.
      else void moveTo(window, asked, both, () => look(both), message)
    } catch (error) {
      toast.error(problem(error, "Move to Project"))
    }
  }

  /** The arrows walk the list, as a menu's, and Enter on the Project
   * picked moves the Thread there. */
  const walk = (event: KeyboardEvent) => {
    const options = [...(list.current?.querySelectorAll("button") ?? [])]
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "Enter" && options[at]?.ariaSelected === "true") {
      event.preventDefault()
      move()
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = options[Math.max(0, Math.min(options.length - 1, at + step))]
    next?.focus()
    next?.click()
  }

  // A machine with nothing to move to has no part, but one that is away,
  // which says so.
  const shown = groups.filter(
    ({ machine, places }) => places.length > 0 || machine.state === "away"
  )
  const stops = across && (said.kind === "refused" || said.kind === "failed")
  const works = busy(listed.mark)
  const who = listed.by ?? "its Agent"
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={start}
        className="sm:max-w-md"
      >
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            move()
          }}
        >
          <DialogHeader>
            <DialogTitle id={label}>Move Thread</DialogTitle>
            <DialogDescription className="truncate">
              {listed.title}
            </DialogDescription>
          </DialogHeader>
          {all.length === 0 ? (
            <p className="text-muted-foreground">
              There is no other Project to move it to.
            </p>
          ) : (
            <div
              ref={list}
              role="listbox"
              aria-labelledby={label}
              onKeyDown={walk}
              className="-mx-2 flex max-h-60 flex-col overflow-y-auto px-2"
            >
              {shown.map(({ machine, places }) => (
                <div key={machine.host ?? ""} role="group" className="contents">
                  {machines.length > 1 && (
                    <div
                      className={cn(
                        "flex items-center px-2 pt-2 pb-1 text-xs text-muted-foreground",
                        machine.state === "away" && "opacity-60"
                      )}
                    >
                      <MachineMark named={machine.named} form="full" />
                      {machine.state === "away" && (
                        <span className="ml-auto pl-4">away</span>
                      )}
                    </div>
                  )}
                  {places.map((place) => {
                    const on = place.project === picked?.project
                    return (
                      <button
                        key={place.project}
                        type="button"
                        role="option"
                        aria-label={
                          machines.length > 1
                            ? `${place.name}, ${machine.named.name}`
                            : place.name
                        }
                        aria-selected={on}
                        ref={
                          on || (!picked && place === all[0])
                            ? start
                            : undefined
                        }
                        onClick={() => setPicked(place)}
                        onDoubleClick={move}
                        className={cn(
                          "flex h-8 shrink-0 items-center gap-2 rounded-control px-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                          on && "bg-accent text-accent-foreground"
                        )}
                      >
                        <ProjectSign
                          project={machine.projects.find(
                            (one) => one.id === place.project
                          )}
                        />
                        <span className="shrink-0 truncate">{place.name}</span>
                        <span
                          dir="rtl"
                          className="ml-auto min-w-0 truncate pl-4 font-mono text-xs text-muted-foreground"
                        >
                          <bdi>{place.folder}</bdi>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          {picked && !across && (
            <p className="text-muted-foreground">
              {who} works in {picked.name} from now on. What it changed here
              stays in this folder.
            </p>
          )}
          {stops && (
            <p className="flex gap-2">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{said.why}</span>
            </p>
          )}
          {picked && across && !stops && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Goes</dt>
                <dd>
                  The whole conversation, with its images and Visuals. {who}{" "}
                  goes on with it on {nameOf(picked.host)}.
                </dd>
                <dt className="text-muted-foreground">Folder</dt>
                <dd aria-live="polite">
                  <Folder said={said} from={nameOf(listed.host)} />
                </dd>
              </dl>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  // As the message box: Enter sends, Shift+Enter breaks.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    move()
                  }
                }}
                rows={2}
                className="resize-none"
                aria-label={`A message for ${who} on ${nameOf(picked.host)}`}
                placeholder={`Write to ${who} on ${nameOf(picked.host)}, to go on there…`}
              />
              {works && (
                <p className="text-muted-foreground">
                  It is at work: it moves once its turn ends, while this window
                  is open.
                </p>
              )}
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {across && message.trim() ? "Move and send" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What the move does with the folder's work, in a line or two, where
 * it goes or stays. */
function Folder({ said, from }: { said: Said; from: string }) {
  switch (said.kind) {
    case "asking":
      return (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3" />
          Looking at both folders…
        </span>
      )
    case "goes": {
      const { branch, changed, ahead } = said
      const files = `${changed} ${changed === 1 ? "file" : "files"} not committed`
      const commits = `${ahead} ${ahead === 1 ? "commit" : "commits"} not pushed`
      const work =
        changed > 0 && ahead > 0
          ? `with ${files} and ${commits}.`
          : changed > 0
            ? `with ${files}.`
            : ahead > 0
              ? `with ${commits}.`
              : "as it is: nothing is left to commit."
      return (
        <>
          {branch && (
            <span className="mr-1.5 inline-flex items-center gap-1 rounded-small bg-muted px-1.5 py-0.5 align-middle font-mono text-xs">
              <GitBranchIcon className="size-3" />
              {branch}
            </span>
          )}
          {branch ? work : `The folder's work, ${work}`}
          <span className="block text-muted-foreground">
            Ignored files stay on {from}.
          </span>
        </>
      )
    }
    case "stays":
      return <span className="text-muted-foreground">{said.why}</span>
    case "refused":
    case "failed":
      return null
  }
}
