/**
 * The updates widget on the bar's right (ADR 0131, decision 1; ADR 0119;
 * ADR 0072): one widget over this window's app and every machine the
 * window shows. The bar has its icon alone, the worst state over them
 * all: red when something failed, a dot when something is ready, the
 * ring while it downloads, else a quiet icon, there only for Banda Dev
 * (ADR 0045). The popover is mock v2's variant A: a title in one line, a
 * row a machine with one word at its right and at most one button, and
 * when they last checked. This machine's row holds this window's app: one
 * Update takes both. Each machine decides for itself; the widget only
 * shows and asks.
 *
 *   in    this window's app's update (the device's `update`), and what
 *         each machine's engine says on `updates.state` (`heard.tsx`)
 *   draws its icon, the worst state over them all, and the popover
 *   runs  `update.check`, `update.restart` and `update.now`, and
 *         `updates.check` and `updates.restart` on a machine
 *
 * It always stands on the bar, last on the right where `[bar]` does not
 * place it (`../layout/placed.ts`).
 */
import type { Widget } from "@banda/ui/module"
import { UPDATE } from "../widget-ids"
import { Button } from "@banda/ui/components/button"
import { MachineIcon } from "@banda/ui/components/machine-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@banda/ui/components/collapsible"
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
import type { Update } from "@banda/core"
import { sameEach, useStore } from "@banda/core/react"
import { CheckIcon, ChevronRightIcon, ClockIcon } from "lucide-react"
import { HERE, StoresContext } from "../../calls/stores"
import {
  FollowUpdates,
  useEngineFor,
  useKeptUpdates,
  useMachineUpdates,
} from "./heard"
import {
  lookedOf,
  lookedWords,
  type MachineUpdates,
  newestOf,
  plainOf,
  type Row,
  rowOf,
  shownOn,
  titleOf,
  type Worst,
  worstOf,
} from "./machines"
import { SHOW_AFTER, UPDATED_FOR } from "./updating"
import { device } from "../../boot"

/** How long the widget takes to grow into the bar or out of it. */
const LEAVES_IN = 240

/** Where this window's app's update is, as main tells it; none outside
 * the desktop. */
function useUpdate(): Update | undefined {
  const [update, setUpdate] = useState<Update>()
  useEffect(() => device.update.follow(setUpdate), [])
  return update
}

/** The rows, this machine's with this window's app in it, and what went
 * wrong as the Person last acted on a machine. */
export function useRows(
  app: Update | undefined,
  machines: readonly MachineUpdates[],
  now: number,
  troubles: ReadonlyMap<string, string>
) {
  return machines.map((machine) => {
    const row = rowOf(
      machine,
      now,
      machine.host === undefined ? app : undefined
    )
    const trouble = troubles.get(machine.host ?? "")
    return {
      machine,
      row: trouble
        ? ({
            ...row,
            kind: "failed",
            status: "Couldn't update",
            why: plainOf(trouble),
            details: trouble,
            act: "retry",
          } satisfies Row)
        : row,
    }
  })
}

/** The widget, on this machine's `engine`. */
export function UpdateWidget({ engine }: { engine: Engine }) {
  const app = useUpdate()
  const machines = useMachineUpdates()
  const now = useNow(MINUTE)
  const [troubles, setTroubles] = useState<ReadonlyMap<string, string>>(
    new Map()
  )
  const rows = useRows(app, machines, now, troubles)
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
  const line = barWords(drawn)
  const widget = (
    <span data-update-slot={shown ? "in" : "out"} className="flex">
      <Popover
        open={open && shown}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setLit(undefined)
            // What changed was seen: the update is `none` again.
            if (app?.state === "updated") device.update.seen()
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={line}
              title={line}
              data-update={drawn.kind}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                drawn.kind === "quiet" && "opacity-55 hover:opacity-100",
                drawn.kind === "failed" &&
                  "text-destructive hover:text-destructive",
                // The check is drawn in the colour of what was added.
                drawn.kind === "updated" && "[&_svg]:text-added"
              )}
            />
          }
        >
          <UpdateIcon worst={drawn} />
        </PopoverTrigger>
        <PopoverContent className="w-80 gap-0 p-1.5 text-ui">
          <About
            app={app}
            machines={machines}
            rows={rows}
            engine={engine}
            lit={lit}
            now={now}
            setTroubles={setTroubles}
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

/** The line on hover, which says what the bar's icon shows. */
export function barWords(worst: Worst): string {
  switch (worst.kind) {
    case "failed":
      return `Couldn't update ${worst.name}`
    case "updated":
      return `Updated to ${worst.version}`
    case "ready":
      return worst.version
        ? `Banda ${worst.version} is ready`
        : "An update is ready"
    case "downloading":
      return `Updating${worst.version ? ` to ${worst.version}` : ""} · ${Math.round(worst.share * 100)}%`
    case "looking":
      return "Checking for updates…"
    case "quiet":
      return "Banda is up to date"
  }
}

/** The popover: its title, a row a machine, and when they checked. */
function About({
  app,
  machines,
  rows,
  engine,
  lit,
  now,
  setTroubles,
}: {
  app: Update | undefined
  machines: readonly MachineUpdates[]
  rows: readonly { machine: MachineUpdates; row: Row }[]
  engine: Engine
  lit?: string
  now: number
  setTroubles: (
    change: (was: ReadonlyMap<string, string>) => ReadonlyMap<string, string>
  ) => void
}) {
  const engineFor = useEngineFor(engine)
  const { title, say } = titleOf(rows, newestOf(app, machines[0]))
  const trouble = (machine: MachineUpdates, why?: string) =>
    setTroubles((was) => {
      const next = new Map(was)
      if (why === undefined) next.delete(machine.host ?? "")
      else next.set(machine.host ?? "", why)
      return next
    })
  const updating = useUpdateThere(engineFor, trouble)
  const check = (machine: MachineUpdates) =>
    void engineFor(machine.host)
      .call("updates.check", {})
      .catch(() => {})
  const checkAll = () => {
    device.update.check()
    for (const { machine } of rows) if (!machine.away) check(machine)
  }
  const retry = (machine: MachineUpdates) => {
    trouble(machine)
    if (machine.host === undefined)
      if (app?.state === "failed") device.update.now()
      else device.update.check()
    check(machine)
  }
  return (
    <>
      <div className="px-2.5 pt-2 pb-0.5">
        <div className="text-ui font-semibold" data-update-title>
          {title}
        </div>
        {say && (
          <div className="mt-0.5 text-meta text-muted-foreground">{say}</div>
        )}
      </div>
      <div className="mt-1">
        {rows.map(({ machine, row }) => (
          <MachineRow
            key={machine.host ?? ""}
            machine={machine}
            row={row}
            lit={lit !== undefined && machine.host === lit}
            onUpdate={() => updating.ask(machine, row)}
            onRetry={() => retry(machine)}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center border-t border-border pt-1 pr-0.5 pl-2.5">
        <span className="text-meta text-muted-foreground">
          {lookedWords(lookedOf(machines), now)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={checkAll}
        >
          Check now
        </Button>
      </div>
      {updating.dialog}
    </>
  )
}

/** A machine's row: its name, one word or one button, and a why. */
function MachineRow({
  machine,
  row,
  lit,
  onUpdate,
  onRetry,
}: {
  machine: MachineUpdates
  row: Row
  lit: boolean
  onUpdate: () => void
  onRetry: () => void
}) {
  return (
    <div
      data-machine={machine.host ?? "here"}
      data-row={row.kind}
      className={cn(
        "grid min-h-8 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-control py-1 pr-1.5 pl-2.5",
        row.kind === "away" && "opacity-55",
        lit && "bg-accent/60"
      )}
    >
      <span className="grid place-items-center text-muted-foreground">
        <MachineIcon icon={machine.icon} size={14} />
      </span>
      <span
        className="min-w-0 truncate font-medium"
        title={row.from && (row.to ? `${row.from} → ${row.to}` : row.from)}
      >
        {machine.name}
        {machine.host === undefined && (
          <span className="ms-1 text-meta font-normal text-muted-foreground">
            this machine
          </span>
        )}
      </span>
      <Corner row={row} onUpdate={onUpdate} onRetry={onRetry} />
      {row.kind === "taking" && (
        <span className="col-span-2 col-start-2 my-0.5 h-0.75 overflow-hidden rounded-full bg-foreground/10">
          <i
            role="progressbar"
            aria-valuenow={Math.round((row.share ?? 0) * 100)}
            className="block h-full bg-foreground opacity-70 transition-[width] duration-500"
            style={{ width: `${(row.share ?? 0) * 100}%` }}
          />
        </span>
      )}
      {row.why && (
        <span className="col-span-2 col-start-2 text-meta leading-snug text-muted-foreground">
          {row.why}
        </span>
      )}
      {row.command && (
        <span className="col-span-2 col-start-2 mt-0.5 flex items-center gap-1.5 rounded-control bg-muted py-1 pr-1 pl-2.5">
          <code className="min-w-0 flex-1 truncate text-meta text-foreground">
            {row.command}
          </code>
          <Copy text={row.command} />
        </span>
      )}
      {row.details && <Details text={row.details} />}
    </div>
  )
}

/** What stands at a row's right: its one button, or its one word. */
function Corner({
  row,
  onUpdate,
  onRetry,
}: {
  row: Row
  onUpdate: () => void
  onRetry: () => void
}) {
  if (row.act === "update")
    return (
      <Button size="sm" onClick={onUpdate}>
        Update
      </Button>
    )
  if (row.act === "retry")
    return (
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    )
  if (!row.status) return <span />
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-muted-foreground tabular-nums"
      )}
    >
      {row.kind === "ok" && <CheckIcon className="size-3.5 text-added" />}
      {row.kind === "waits" && row.status.startsWith("After") && (
        <ClockIcon className="size-3.25" />
      )}
      {row.status}
    </span>
  )
}

/** What went wrong, as the program said it: folded under Details. */
function Details({ text }: { text: string }) {
  return (
    <Collapsible className="col-span-2 col-start-2 text-small text-muted-foreground">
      <CollapsibleTrigger className="group inline-flex items-center gap-0.5 hover:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        Details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 mb-0.5 rounded-small bg-foreground/6 px-2 py-1.5 font-mono text-small whitespace-pre-wrap select-text">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Update on a machine (ADR 0131, decision 1): this window's app restarts
 * at once, and the engine moves now where nothing runs. While Agents work
 * there it asks once, and waiting is the default: a machine that updates
 * by itself once idle does so, and this window's app restarts all the
 * same, as it stops no Agent. What fails is said on the row (`trouble`).
 * `ask` updates a machine's row; `dialog` is drawn where it asks.
 */
export function useUpdateThere(
  engineFor: (host: string | undefined) => Engine,
  trouble: (machine: MachineUpdates, why?: string) => void
) {
  const [asking, setAsking] = useState<{ machine: MachineUpdates; row: Row }>()
  const close = useCallback(() => setAsking(undefined), [])
  const restartApp = (row: Row) => {
    if (row.app) device.update.restart()
  }
  const restartEngine = (machine: MachineUpdates, force: boolean) =>
    engineFor(machine.host)
      .call("updates.restart", force ? { force: true } : {})
      .then(
        () => true,
        (error: Error) => {
          trouble(machine, error.message)
          return false
        }
      )
  const ask = (machine: MachineUpdates, row: Row) => {
    trouble(machine)
    if (!row.engine) return restartApp(row)
    if ((machine.said?.waits?.turns ?? 0) > 0) setAsking({ machine, row })
    else
      void restartEngine(machine, false).then((done) => done && restartApp(row))
  }
  const now = () => {
    if (!asking) return
    const { machine, row } = asking
    close()
    void restartEngine(machine, true).then((done) => done && restartApp(row))
  }
  const later = () => {
    if (!asking) return
    close()
    restartApp(asking.row)
  }
  return {
    ask,
    dialog: (
      <UpdateDialog
        machine={asking?.machine}
        onNow={now}
        onLater={later}
        onClose={close}
      />
    ),
  }
}

/** While Agents work there: wait for them, or stop them and update. */
function UpdateDialog({
  machine,
  onNow,
  onLater,
  onClose,
}: {
  machine: MachineUpdates | undefined
  onNow: () => void
  onLater: () => void
  onClose: () => void
}) {
  const working = useWorkingOn(machine?.host)
  const turns = machine?.said?.waits?.turns ?? 0
  const name = machine?.name ?? ""
  // One set to ask takes nothing by itself: waiting is only a Cancel.
  const asks =
    machine?.said?.takes === "ask" || machine?.said?.waits?.person === true
  const agents = turns === 1 ? "An Agent is" : `${turns} Agents are`
  return (
    <Dialog
      open={machine !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {agents} working on {name}
          </DialogTitle>
          <DialogDescription>
            Updating now stops {turns === 1 ? "it" : "them"}.
            {!asks && " Or Banda updates by itself as soon as they finish."}
          </DialogDescription>
        </DialogHeader>
        {working.length > 0 && (
          <ul className="list-disc ps-5 text-ui leading-relaxed text-muted-foreground">
            {working.map((title, i) => (
              <li key={`${i}-${title}`}>{title}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onNow}
          >
            Stop {turns === 1 ? "it" : "them"} and update
          </Button>
          <Button type="button" autoFocus onClick={asks ? onClose : onLater}>
            {asks ? "Cancel" : "Update when they finish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Says that Banda updated `UPDATED_FOR`, unless the Person opened the
 * popover: then until they close it (ADR 0072, decision 4). */
function useUpdatedFor(update: Update | undefined, open: boolean) {
  const updated = update?.state === "updated"
  useEffect(() => {
    if (!updated || open) return
    // Only while the window has the focus: a Mac's Banda that updated
    // unseen opens with no window (ADR 0121), and says so once the Person
    // comes to it. A window opened hidden is not, to its page, hidden.
    let timer: ReturnType<typeof setTimeout> | undefined
    const follow = () => {
      clearTimeout(timer)
      timer = document.hasFocus()
        ? setTimeout(() => device.update.seen(), UPDATED_FOR)
        : undefined
    }
    follow()
    addEventListener("focus", follow)
    addEventListener("blur", follow)
    return () => {
      clearTimeout(timer)
      removeEventListener("focus", follow)
      removeEventListener("blur", follow)
    }
  }, [updated, open])
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

/** The arrow up in a circle (ADR 0072, decision 2): drawn to the share
 * that is down, a green dot once a version is ready,
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
  const state = worst.kind
  const dot = worst.kind === "ready"
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

export const updateWidget: Widget = {
  id: UPDATE,
  about:
    "Banda's updates, of this window and of each machine: what is ready, and a restart into it.",
  Widget: ({ engine }) => <UpdateWidget engine={engine} />,
}
