/**
 * The updates widget on the bar's right (ADR 0115, decision 7; ADR 0041,
 * decision 4; ADR 0072): one widget over this window's app and every
 * machine the window shows, this one too. Its icon and pill say the worst
 * state over them all: failed, in `--destructive`, with where; a machine
 * that waits to restart; a version ready, a green dot and the version; a
 * download, the circle filling; else a quiet icon, there only for Banda
 * Dev (ADR 0045). The popover is the chosen mock's variant A: this
 * window's own row first, as the app restarts at once and the engine
 * waits; then a row for each machine, from what its engine says on
 * `updates.state`, with its acts; what changed; and when they looked.
 * Each machine decides for itself; the widget only shows and asks.
 */
import { Button } from "@banda/ui/components/button"
import { MachineIcon } from "@banda/ui/components/machine-icon"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { works } from "@banda/ui/components/banda-mark"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE } from "@banda/ui/lib/words"
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { Engine } from "@banda/contract"
import type { Note, Update } from "@banda/core"
import { sameEach, useStore } from "@banda/core/react"
import { CheckIcon, PanelsLeftBottomIcon } from "lucide-react"
import { HERE, StoresContext } from "../calls/stores"
import {
  FollowUpdates,
  useEngineFor,
  useKeptUpdates,
  useMachineUpdates,
} from "./heard"
import {
  allOn,
  lookedOf,
  lookedWords,
  type MachineUpdates,
  newestOf,
  outWords,
  type Row,
  rowOf,
  shownOn,
  type Worst,
  worstOf,
} from "./machines"
import {
  firstOf,
  groupsOf,
  lineOf,
  SHOW_AFTER,
  shortOf,
  UPDATED_FOR,
} from "./updating"

/** The notes the popover lists before "Show all". */
const NOTES = 3

/** How long the widget takes to grow into the bar or out of it. */
const LEAVES_IN = 240

const host = () => window.banda?.update

/** Where this window's app's update is, as main tells it; none outside
 * the desktop. */
function useUpdate(): Update | undefined {
  const [update, setUpdate] = useState<Update>()
  useEffect(() => {
    const update = host()
    if (!update) return
    let live = true
    update.current().then(
      (now) => live && setUpdate(now),
      () => {}
    )
    const stop = update.listen(setUpdate)
    return () => {
      live = false
      stop()
    }
  }, [])
  return update
}

/** The widget, on this machine's `engine`. */
export function UpdateWidget({ engine }: { engine: Engine }) {
  const app = useUpdate()
  const machines = useMachineUpdates()
  const now = useNow(MINUTE)
  const rows = machines.map((machine) => ({
    machine,
    row: rowOf(machine, now),
  }))
  const worst = worstOf(app, rows)
  const [open, setOpen] = useState(false)
  const { opened } = useKeptUpdates()
  // The machine the sidebar opened it at.
  const [lit, setLit] = useState<string>()
  useEffect(
    () =>
      opened.subscribe(() => {
        setLit(opened.get().host)
        setOpen(true)
      }),
    [opened]
  )
  const shown = shownOn(worst, app) || open
  // What it last showed, while it shrinks out of the bar.
  const [last, setLast] = useState<Worst>()
  if (shown && !sameWorst(worst, last)) setLast(worst)
  useEffect(() => {
    if (shown) return
    const timer = setTimeout(() => setLast(undefined), LEAVES_IN)
    return () => clearTimeout(timer)
  }, [shown])
  useUpdatedFor(app, open)
  const drawn = shown ? worst : last
  const follow = <FollowUpdates engine={engine} />
  if (!drawn) return follow
  const line = drawn.app && app ? lineOf(app) : barWords(drawn)
  const pill = "pill" in drawn ? drawn.pill : undefined
  const widget = (
    <span data-update-slot={shown ? "in" : "out"} className="flex">
      <Popover
        open={open && shown}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setLit(undefined)
            // What changed was seen: the update is `none` again.
            if (app?.state === "updated") host()?.seen()
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size={pill ? "sm" : "icon-sm"}
              aria-label={line}
              title={line}
              data-update={drawn.kind}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                drawn.kind === "quiet" && "opacity-55 hover:opacity-100",
                drawn.kind === "failed" &&
                  "text-destructive hover:text-destructive",
                pill && "h-7 gap-1.5 ps-1.5 pe-1.5",
                // The check is drawn in the colour of what was added.
                drawn.kind === "updated" && "[&_svg]:text-added"
              )}
            />
          }
        >
          <UpdateIcon worst={drawn} />
          {pill && (
            <span
              className={cn(
                "h-4.5 rounded-full bg-foreground/8 px-1.5 font-mono text-small leading-4.5 tracking-tight",
                drawn.kind === "waits"
                  ? "text-muted-foreground"
                  : "text-foreground"
              )}
            >
              {pill}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-100 gap-0 p-1.5 text-ui">
          <About
            app={app}
            machines={machines}
            rows={rows}
            engine={engine}
            lit={lit}
            now={now}
          />
        </PopoverContent>
      </Popover>
    </span>
  )
  return (
    <>
      {follow}
      {/* A download over in two seconds never shows. */}
      {drawn.kind === "downloading" && !app?.always && !open ? (
        <After ms={SHOW_AFTER}>{widget}</After>
      ) : (
        widget
      )}
    </>
  )
}

const sameWorst = (a: Worst, b: Worst | undefined) =>
  b !== undefined && JSON.stringify(a) === JSON.stringify(b)

/** The line on hover, which says what the bar's widget shows. */
export function barWords(worst: Worst): string {
  switch (worst.kind) {
    case "failed":
      return worst.pill === "window"
        ? "This window cannot update itself"
        : `${worst.pill} could not update`
    case "updated":
      return `Updated to ${worst.pill}`
    case "waits":
      return `${worst.pill} for its Agents to finish`
    case "ready":
      return `${worst.pill} is ready`
    case "downloading":
      return `Downloading${worst.version ? ` ${worst.version}` : ""} · ${Math.round(worst.share * 100)}%`
    case "looking":
      return "Looking for a new version…"
    case "quiet":
      return "Every machine runs the newest"
  }
}

/** Says that Banda updated `UPDATED_FOR`, unless the Person opened the
 * popover: then until they close it (ADR 0072, decision 4). */
function useUpdatedFor(update: Update | undefined, open: boolean) {
  const updated = update?.state === "updated"
  useEffect(() => {
    if (!updated || open) return
    const timer = setTimeout(() => host()?.seen(), UPDATED_FOR)
    return () => clearTimeout(timer)
  }, [updated, open])
}

/** The popover: its head, this window's row, each machine's, what
 * changed, and when they looked. */
function About({
  app,
  machines,
  rows,
  engine,
  lit,
  now,
}: {
  app: Update | undefined
  machines: readonly MachineUpdates[]
  rows: readonly { machine: MachineUpdates; row: Row }[]
  engine: Engine
  lit?: string
  now: number
}) {
  const engineFor = useEngineFor(engine)
  const newest = newestOf(app, machines[0])
  const everyOn = newest ? allOn(newest.version, app, machines) : false
  const corner = outWords(newest, everyOn, now)
  const notes = app && "notes" in app ? app.notes : []
  const restart = useRestartThere(engineFor)
  const checkAll = () => {
    host()?.check()
    for (const { machine } of rows)
      if (machine.host && !machine.away)
        void engineFor(machine.host)
          .call("updates.check", {})
          .catch(() => {})
  }
  return (
    <>
      <div className="flex items-baseline gap-2 px-2.5 pt-2 pb-1.5">
        <span className="text-ui font-semibold">
          {app?.name ?? "Banda"}
          {newest && ` ${shortOf(newest.version)}`}
        </span>
        {corner && (
          <span className="ml-auto text-meta text-muted-foreground tabular-nums">
            {corner}
          </span>
        )}
      </div>
      <WindowRow app={app} />
      {app && windowShown(app) && <Sep />}
      {rows.map(({ machine, row }) => (
        <MachineRow
          key={machine.host ?? ""}
          machine={machine}
          row={row}
          lit={lit !== undefined && machine.host === lit}
          onRestart={() => restart.ask(machine)}
          onCheck={() =>
            void engineFor(machine.host)
              .call("updates.check", {})
              .catch(() => {})
          }
        />
      ))}
      {notes.length > 0 && (
        <>
          <Sep />
          <Notes notes={notes} />
        </>
      )}
      <Sep />
      <div className="flex items-center gap-1.5 py-1 pr-1.5 pl-2.5">
        <span className="text-meta text-muted-foreground">
          {app?.state === "none" && app.missed ? (
            <span className="text-destructive">
              Could not update: {app.missed}
            </span>
          ) : (
            lookedWords(lookedOf(machines), now)
          )}
        </span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={checkAll}>
            Check now
          </Button>
        </span>
      </div>
      {restart.dialog}
    </>
  )
}

/** Whether this window has a row: once its new app is down, out on
 * macOS, failed, or just came. */
const windowShown = (app: Update) =>
  ["ready", "out", "failed", "updated"].includes(app.state)

/** This window's own row (ADR 0115, decision 7): it restarts at once,
 * and the Agents go on. */
function WindowRow({ app }: { app: Update | undefined }) {
  if (!app || !windowShown(app)) return null
  const from = shortOf(app.have)
  const name = (
    <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      <b className="font-medium">This window</b>
    </span>
  )
  const icon = (
    <span className="grid place-items-center text-muted-foreground">
      <PanelsLeftBottomIcon className="size-3.75" />
    </span>
  )
  switch (app.state) {
    case "ready":
      return (
        <RowGrid data-machine="window">
          {icon}
          {name}
          <span className="flex gap-1">
            <PopoverClose render={<Button variant="ghost" size="sm" />}>
              Later
            </PopoverClose>
            <PopoverClose
              render={<Button size="sm" />}
              onClick={() => host()?.restart()}
            >
              Restart window
            </PopoverClose>
          </span>
          <Say>
            {from} → {shortOf(app.version)}. Agents keep working: only the
            window restarts.
          </Say>
        </RowGrid>
      )
    case "out":
      return (
        <RowGrid data-machine="window">
          {icon}
          {name}
          <span />
          <Say>
            {from} → {shortOf(app.version)}. Its app updates with Homebrew:
            <span className="mt-1.5 flex items-center gap-1.5 rounded-control bg-muted py-1 pr-1 pl-2.5">
              <code className="min-w-0 flex-1 truncate text-meta text-foreground">
                {app.command}
              </code>
              <Copy text={app.command} />
            </span>
          </Say>
        </RowGrid>
      )
    case "failed":
      return (
        <RowGrid data-machine="window">
          {icon}
          {name}
          <Button variant="outline" size="sm" onClick={() => host()?.now()}>
            Try again
          </Button>
          <Say bad>{app.reason}</Say>
        </RowGrid>
      )
    case "updated":
      return (
        <RowGrid data-machine="window">
          {icon}
          <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
            <b className="font-medium">This window</b>
            <Version>{shortOf(app.have)}</Version>
          </span>
          <span className="inline-flex text-added">
            <CheckIcon className="size-3.5" />
          </span>
          <Say>Updated from {shortOf(app.from)}. Here is what changed.</Say>
        </RowGrid>
      )
    default:
      return null
  }
}

/** A machine's row. */
function MachineRow({
  machine,
  row,
  lit,
  onRestart,
  onCheck,
}: {
  machine: MachineUpdates
  row: Row
  lit: boolean
  onRestart: () => void
  onCheck: () => void
}) {
  return (
    <RowGrid
      data-machine={machine.host ?? "here"}
      data-row={row.kind}
      className={cn(row.kind === "away" && "opacity-60", lit && "bg-accent/60")}
    >
      <span className="grid place-items-center text-muted-foreground">
        <MachineIcon icon={machine.icon} size={14} />
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <b className="font-medium">{machine.name}</b>
        {row.from && (
          <Version>
            {row.from}
            {row.to && (
              <>
                {" → "}
                <span className="text-foreground">{row.to}</span>
              </>
            )}
          </Version>
        )}
      </span>
      <Corner row={row} onRestart={onRestart} onCheck={onCheck} />
      {row.kind === "taking" ? (
        <span className="col-span-2 col-start-2 h-0.75 overflow-hidden rounded-full bg-foreground/10">
          <i
            role="progressbar"
            aria-valuenow={Math.round((row.share ?? 0) * 100)}
            className="block h-full bg-foreground opacity-70 transition-[width] duration-500"
            style={{ width: `${(row.share ?? 0) * 100}%` }}
          />
        </span>
      ) : (
        row.say && <Say bad={row.kind === "failed"}>{row.say}</Say>
      )}
    </RowGrid>
  )
}

/** What stands at a row's right: its act, its check, or a word. */
function Corner({
  row,
  onRestart,
  onCheck,
}: {
  row: Row
  onRestart: () => void
  onCheck: () => void
}) {
  switch (row.kind) {
    case "ok":
      return row.from ? (
        <span className="inline-flex text-added">
          <CheckIcon className="size-3.5" />
        </span>
      ) : (
        <span />
      )
    case "away":
      return <Version>away</Version>
    case "taking":
      return <Version>{row.size}</Version>
    case "failed":
      return (
        <Button variant="outline" size="sm" onClick={onCheck}>
          Try again
        </Button>
      )
    case "ask":
      return (
        <Button variant="outline" size="sm" onClick={onRestart}>
          Restart
        </Button>
      )
    case "waits":
      return row.restarts ? (
        <Button variant="ghost" size="sm" onClick={onRestart}>
          Restart now
        </Button>
      ) : (
        <span />
      )
    default:
      return <span />
  }
}

/** Restart now on a machine (ADR 0115, decision 3): at once while no
 * Agent works there; else it asks first, Cancel the default, and lists
 * the Threads whose turns it stops. A restart refused as Agents began
 * meanwhile asks after all. `ask` restarts a machine; `dialog` is drawn
 * where it asks. */
export function useRestartThere(
  engineFor: (host: string | undefined) => Engine
) {
  const [asking, setAsking] = useState<MachineUpdates>()
  const [failed, setFailed] = useState<string>()
  const close = useCallback(() => {
    setAsking(undefined)
    setFailed(undefined)
  }, [])
  const ask = (machine: MachineUpdates) => {
    if ((machine.said?.waits?.turns ?? 0) > 0) setAsking(machine)
    else
      void engineFor(machine.host)
        .call("updates.restart", {})
        .catch((error: Error) => {
          setFailed(error.message)
          setAsking(machine)
        })
  }
  const force = () => {
    if (!asking) return
    engineFor(asking.host)
      .call("updates.restart", { force: true })
      .then(close, (error: Error) => setFailed(error.message))
  }
  return {
    ask,
    dialog: (
      <RestartDialog
        machine={asking}
        failed={failed}
        onRestart={force}
        onClose={close}
      />
    ),
  }
}

function RestartDialog({
  machine,
  failed,
  onRestart,
  onClose,
}: {
  machine: MachineUpdates | undefined
  failed: string | undefined
  onRestart: () => void
  onClose: () => void
}) {
  const working = useWorkingOn(machine?.host)
  const terminals = machine?.said?.waits?.terminals ?? 0
  const name = machine?.name ?? ""
  return (
    <Dialog
      open={machine !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Restart Banda on {name} now?</DialogTitle>
          <DialogDescription>
            Agents work on {name}. A restart stops their turns
            {working.length > 0 ? ":" : "."}
          </DialogDescription>
        </DialogHeader>
        {working.length > 0 && (
          <ul className="list-disc ps-5 text-ui leading-relaxed">
            {working.map((title, i) => (
              <li key={`${i}-${title}`}>{title}</li>
            ))}
          </ul>
        )}
        {terminals > 0 && (
          <p className="text-ui text-muted-foreground">
            {terminals === 1
              ? "A terminal is open there and ends too."
              : `${terminals} terminals are open there and end too.`}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-meta text-destructive">
            {failed}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onRestart}>
            Restart anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The titles of the Threads at work on host `host`, this machine's
 * where none, as its Watches list them. */
function useWorkingOn(host: string | undefined): string[] {
  const stores = useContext(StoresContext)
  const select = useCallback(
    () =>
      Object.values(stores.hosts.get(host ?? HERE) ?? {})
        .flat()
        .filter((listed) => works(listed.mark))
        .map((listed) => listed.title),
    [stores, host]
  )
  return useStore(stores.items, select, sameEach)
}

function RowGrid({
  className,
  children,
  ...rest
}: {
  className?: string
  children: ReactNode
  "data-machine"?: string
  "data-row"?: string
}) {
  return (
    <div
      {...rest}
      className={cn(
        "grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-control px-2.5 py-2 hover:bg-foreground/5",
        className
      )}
    >
      {children}
    </div>
  )
}

function Say({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "col-span-2 col-start-2 text-meta leading-snug",
        bad ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {children}
    </span>
  )
}

function Version({ children }: { children: ReactNode }) {
  return (
    <span className="text-meta text-muted-foreground tabular-nums">
      {children}
    </span>
  )
}

function Sep() {
  return <div className="mx-1.5 my-1 h-px bg-border" />
}

/** Copies `text`, and says so a moment. */
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/** What changed, by kind, the newest's version beside New; a few, and
 * the rest on "Show all" (ADR 0072, decision 5). */
function Notes({ notes }: { notes: readonly Note[] }) {
  const [all, setAll] = useState(false)
  const groups = groupsOf(notes)
  const listed = all ? groups : firstOf(groups, NOTES)
  const newest = notes[0]?.version
  return (
    <div className="max-h-56 overflow-y-auto px-2.5 pt-0.5 pb-1.5 text-ui">
      {listed.map((group) => (
        <section key={group.title}>
          <h4 className="mt-1.5 mb-0.5 text-small font-medium text-muted-foreground">
            {group.title === "New" && newest
              ? `New in ${shortOf(newest)}`
              : group.title}
          </h4>
          <ul className="list-disc ps-4 leading-relaxed">
            {group.lines.map((line) => (
              <li key={`${line.version}-${line.text}`} title={line.version}>
                {line.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!all && notes.length > NOTES && (
        <button
          type="button"
          className="mt-1 text-meta text-muted-foreground hover:text-foreground"
          onClick={() => setAll(true)}
        >
          Show all {notes.length}
        </button>
      )}
    </div>
  )
}

/** The arrow up in a circle (ADR 0072, decision 2): drawn to the share
 * that is down, a green dot once a version is ready or a machine waits,
 * a short arc running round while Banda looks, a `!` when it failed, and
 * a check once Banda updated. globals.css moves it by
 * `data-update-icon`. */
function UpdateIcon({ worst }: { worst: Worst }) {
  const around = 2 * Math.PI * 9.5
  const share =
    worst.kind === "downloading"
      ? worst.share
      : worst.kind === "looking"
        ? 0.22
        : 1
  const state = worst.kind === "waits" ? "ready" : worst.kind
  const dot = worst.kind === "ready" || worst.kind === "waits"
  return (
    <span className="relative inline-grid place-items-center">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-update-icon={state}
        className="size-4 shrink-0 overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle data-track cx="12" cy="12" r="9.5" />
        <circle
          data-ring
          cx="12"
          cy="12"
          r="9.5"
          strokeDasharray={around}
          strokeDashoffset={around * (1 - share)}
        />
        <path data-arrow d="M12 16.2V8.3M8.6 11.6 12 8.2l3.4 3.4" />
        <path data-check d="m8.4 12.3 2.5 2.5 4.8-5" />
        <path data-bang d="M12 7.6v5.2M12 16.3v.1" />
      </svg>
      {dot && (
        <span
          data-update-dot
          className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-added ring-2 ring-background"
        />
      )}
    </span>
  )
}

/** Draws `children` only once it has been there `ms` milliseconds. */
function After({ ms, children }: { ms: number; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(timer)
  }, [ms])
  return shown ? children : null
}
