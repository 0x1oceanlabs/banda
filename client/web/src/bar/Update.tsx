/**
 * Banda's own update on the bar's right (ADR 0041, decision 4; ADR 0072):
 * an arrow in a circle, in the bar's muted text, only while there is
 * something to say. The circle fills as a version downloads, once that
 * has run two seconds; once one is ready, the version stands beside it,
 * and a click shows what changed and restarts into it, or waits for the
 * Threads to stop. The new Banda says it updated, six seconds. In
 * `--destructive` only when the Person has to mend something. Banda
 * Dev's stays on the bar, dimmed, with "Update now" (ADR 0045). On macOS
 * a version out shows the same, with the brew command to copy.
 */
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE } from "@banda/ui/lib/words"
import { type ReactNode, useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Note, Update } from "@banda/core"
import {
  firstOf,
  groupsOf,
  IDLE_FOR,
  lineOf,
  lookedWords,
  percentOf,
  pillOf,
  SHOW_AFTER,
  shortOf,
  sizeWords,
  UPDATED_FOR,
  versionsWords,
  waitWords,
  workingWords,
} from "./updating"
import { useRunningHere } from "./running"

/** The notes the popover lists before "Show all". */
const NOTES = 6

/** How long the widget takes to grow into the bar or out of it. */
const LEAVES_IN = 240

const host = () => window.banda?.update

/** Where Banda's own update is, as main tells it; none outside the
 * desktop. */
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

/** Whether the bar shows `update` at all. */
const shown = (update: Update | undefined): update is Update =>
  update !== undefined && (update.state !== "none" || update.always)

/** The update's widget, on this machine's `engine`; `working` is how many
 * Threads work now. */
export function UpdateWidget({
  engine,
  working,
}: {
  engine: Engine
  working: number
}) {
  const update = useUpdate()
  // What it last showed, while it shrinks out of the bar.
  const [last, setLast] = useState<Update>()
  const [open, setOpen] = useState(false)
  const now = shown(update) ? update : undefined
  if (now && now !== last) setLast(now)
  useEffect(() => {
    if (now) return
    const timer = setTimeout(() => setLast(undefined), LEAVES_IN)
    return () => clearTimeout(timer)
  }, [now])
  // Only a version ready to restart into waits for them.
  const running = useRunningHere(engine, now?.state === "ready")
  useRestartWhenIdle(now, working, running)
  useUpdatedFor(now, open)
  const drawn = now ?? last
  if (!drawn) return null
  const pill = pillOf(drawn)
  const line = lineOf(drawn)
  const widget = (
    <span data-update-slot={now ? "in" : "out"} className="flex">
      <Popover
        open={open && Boolean(now)}
        onOpenChange={(next) => {
          setOpen(next)
          // What changed was seen: the update is `none` again.
          if (!next && drawn.state === "updated") host()?.seen()
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size={pill ? "sm" : "icon-sm"}
              aria-label={line}
              title={line}
              data-update={drawn.state}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                drawn.state === "none" && "opacity-55 hover:opacity-100",
                drawn.state === "failed" &&
                  "text-destructive hover:text-destructive",
                pill &&
                  "h-7 gap-1.5 bg-added/14 ps-1.5 pe-2 text-foreground hover:bg-added/22",
                // The check is drawn in the colour of what was added.
                drawn.state === "updated" && "[&_svg]:text-added",
                drawn.state === "ready" &&
                  drawn.waits &&
                  "bg-attention/14 hover:bg-attention/22"
              )}
            />
          }
        >
          <UpdateIcon update={drawn} />
          {pill && (
            <span className="font-mono text-small tracking-tight">{pill}</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-84 gap-0 p-0">
          <About update={drawn} working={working} running={running} />
        </PopoverContent>
      </Popover>
    </span>
  )
  // Banda Dev's widget is there all along, its popover maybe open: it
  // does not hide while a download starts.
  return drawn.state === "downloading" && !drawn.always ? (
    <After ms={SHOW_AFTER}>{widget}</After>
  ) : (
    widget
  )
}

/** Restarts into a version that waits for the Threads and this machine's
 * terminals, once no Thread has worked, and no program run in front, for
 * `IDLE_FOR` (ADR 0072, decision 3): `running` is none until its terminals
 * have answered, so it waits for that too. */
function useRestartWhenIdle(
  update: Update | undefined,
  working: number,
  running: number | undefined
) {
  const waits = update?.state === "ready" && update.waits
  const idle = working === 0 && running === 0
  useEffect(() => {
    if (!waits || !idle) return
    const timer = setTimeout(() => host()?.restart(), IDLE_FOR)
    return () => clearTimeout(timer)
  }, [waits, idle])
}

/** Says that Banda updated `UPDATED_FOR`, unless the Person opened what
 * changed: then until they close it (ADR 0072, decision 4). */
function useUpdatedFor(update: Update | undefined, open: boolean) {
  const updated = update?.state === "updated"
  useEffect(() => {
    if (!updated || open) return
    const timer = setTimeout(() => host()?.seen(), UPDATED_FOR)
    return () => clearTimeout(timer)
  }, [updated, open])
}

/** What the popover says. */
function About({
  update,
  working,
  running,
}: {
  update: Update
  working: number
  running: number | undefined
}) {
  const at = useNow(MINUTE)
  const warning = workingWords(working, running)
  switch (update.state) {
    case "downloading": {
      const size = sizeWords(update)
      return (
        <>
          <Head
            update={update}
            to={update.version}
            corner={percentOf(update.share)}
            words={
              versionsWords(update.notes) ??
              `${update.name} ${shortOf(update.version)}`
            }
          />
          <div className="px-3.5">
            <Meter share={update.share} />
            {size && (
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                {size}
              </p>
            )}
            <Notes notes={update.notes} />
          </div>
          <Foot
            words={
              update.restarts
                ? "Restarts when it is down"
                : `Installs when you quit ${update.name}`
            }
          >
            {update.restarts ? (
              <Button variant="ghost" size="sm" onClick={() => host()?.later()}>
                Don't restart
              </Button>
            ) : (
              <Button size="sm" onClick={() => host()?.now()}>
                Restart when down
              </Button>
            )}
          </Foot>
        </>
      )
    }
    case "ready":
      if (update.waits)
        return (
          <>
            <Head
              update={update}
              to={update.version}
              words={waitWords(working, running)}
            />
            <div className="px-3.5">
              <Notes notes={update.notes} />
            </div>
            <Foot words="Then it restarts by itself">
              <Button variant="ghost" size="sm" onClick={() => host()?.later()}>
                Cancel
              </Button>
              <Restart>Restart now</Restart>
            </Foot>
          </>
        )
      return (
        <>
          <Head
            update={update}
            to={update.version}
            words={[versionsWords(update.notes), "ready to install"]
              .filter(Boolean)
              .join(" · ")}
          />
          <div className="px-3.5">
            <Notes notes={update.notes} />
          </div>
          <Warning words={warning} />
          <Foot>
            {warning ? (
              <>
                <Restart variant="ghost">Restart now</Restart>
                <Button size="sm" onClick={() => host()?.wait()}>
                  Restart when idle
                </Button>
              </>
            ) : (
              <>
                <Later />
                <Restart>Restart</Restart>
              </>
            )}
          </Foot>
        </>
      )
    case "out":
      return (
        <>
          <Head
            update={update}
            to={update.version}
            words={[versionsWords(update.notes), "install it with brew"]
              .filter(Boolean)
              .join(" · ")}
          />
          <div className="px-3.5">
            <Notes notes={update.notes} />
            <div className="mt-2.5 flex items-center gap-1.5 rounded-control bg-muted py-1 pr-1 pl-2.5">
              <code className="min-w-0 flex-1 truncate text-xs">
                {update.command}
              </code>
              <Copy text={update.command} />
            </div>
          </div>
          <Foot>
            <Later />
          </Foot>
        </>
      )
    case "updated":
      return (
        <>
          <Head
            update={update}
            from={update.from}
            to={update.have}
            corner={<span className="text-added">Updated</span>}
            words="You're on the new version. Here is what changed."
          />
          <div className="px-3.5">
            <Notes notes={update.notes} />
          </div>
          <Foot>
            <PopoverClose render={<Button size="sm" />}>Got it</PopoverClose>
          </Foot>
        </>
      )
    case "failed":
      return (
        <>
          <div className="px-3.5 pt-3 pb-2.5">
            <p className="text-meta text-muted-foreground">{update.name}</p>
            <p className="mt-0.5 text-sm font-medium">Cannot update itself</p>
          </div>
          <p className="mx-3.5 rounded-control bg-destructive/10 px-2.5 py-2 font-mono text-xs break-words text-destructive">
            {update.reason}
          </p>
          <Foot>
            <Later />
            <Button size="sm" onClick={() => host()?.now()}>
              Try again
            </Button>
          </Foot>
        </>
      )
    default: {
      // Nothing new known, or a look the Person asked for.
      const looking = update.state === "looking"
      return (
        <>
          <div className="px-3.5 pt-3 pb-1">
            <p className="text-meta text-muted-foreground">{update.name}</p>
            <p className="mt-0.5 font-mono text-sm font-medium">
              {shortOf(update.have)}
            </p>
            <p className="mt-1 line-clamp-3 text-xs break-words text-muted-foreground">
              {looking ? "Looking for a new version…" : lookedWords(update, at)}
            </p>
          </div>
          <Foot>
            {!looking && <Later />}
            <Button size="sm" disabled={looking} onClick={() => host()?.now()}>
              Update now
            </Button>
          </Foot>
        </>
      )
    }
  }
}

/** The popover's head: the app, where it goes from and to, and a word on
 * how (ADR 0072, decision 5). */
function Head({
  update,
  from = update.have,
  to,
  corner,
  words,
}: {
  update: Update
  from?: string
  to: string
  corner?: ReactNode
  words?: string
}) {
  return (
    <div className="px-3.5 pt-3 pb-2.5">
      <p className="flex justify-between text-meta text-muted-foreground tabular-nums">
        <span>{update.name}</span>
        {corner}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1.5 font-mono">
        <span className="text-ui text-muted-foreground">{shortOf(from)}</span>
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <span className="text-sm font-medium">{shortOf(to)}</span>
      </p>
      {words && <p className="mt-1 text-xs text-muted-foreground">{words}</p>}
    </div>
  )
}

/** The popover's buttons, with a word on the left. */
function Foot({ words, children }: { words?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-1.5 px-3.5 pt-3 pb-3">
      {words && (
        <span className="mr-auto text-xs text-muted-foreground">{words}</span>
      )}
      {children}
    </div>
  )
}

/** How much is down. */
function Meter({ share }: { share: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(share * 100)}
      className="h-1 overflow-hidden rounded-full bg-muted"
    >
      <div
        data-update-meter
        className="h-full rounded-full bg-foreground transition-[width] duration-500"
        style={{ width: `${share * 100}%` }}
      />
    </div>
  )
}

/** That a restart stops the turns of the Threads that work, if any do. */
function Warning({ words }: { words: string | undefined }) {
  return words ? (
    <p className="mx-3.5 mt-2.5 flex gap-2 rounded-control bg-attention/10 px-2.5 py-2 text-xs text-attention">
      <span
        aria-hidden
        data-update-breath
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-attention"
      />
      {words}
    </p>
  ) : null
}

/** Installs the version that is ready and restarts into it now. */
function Restart({
  variant,
  children,
}: {
  variant?: "ghost"
  children: ReactNode
}) {
  return (
    <PopoverClose
      render={<Button size="sm" variant={variant} />}
      onClick={() => host()?.restart()}
    >
      {children}
    </PopoverClose>
  )
}

/** Closes the popover, and leaves the update as it is. */
function Later() {
  return (
    <PopoverClose render={<Button variant="ghost" size="sm" />}>
      Later
    </PopoverClose>
  )
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

/** What changed, by kind, the scope beside each; six, and the rest on
 * "Show all" (ADR 0072, decision 5). */
function Notes({ notes }: { notes: readonly Note[] }) {
  const [all, setAll] = useState(false)
  if (notes.length === 0) return null
  const groups = groupsOf(notes)
  const listed = all ? groups : firstOf(groups, NOTES)
  return (
    <div className="mt-2.5 max-h-48 overflow-y-auto border-t pt-2">
      {listed.map((group) => (
        <section key={group.title} className="mt-1 first:mt-0">
          <h4 className="mb-1 text-small font-medium tracking-wider text-muted-foreground uppercase">
            {group.title}
          </h4>
          <ul className="flex flex-col gap-1">
            {group.lines.map((line) => (
              <li
                key={`${line.version}-${line.text}`}
                className="flex gap-2 text-xs leading-snug"
                title={line.version}
              >
                <span className="w-16 shrink-0 truncate pt-px font-mono text-meta text-muted-foreground">
                  {line.scope ?? shortOf(line.version)}
                </span>
                <span className="min-w-0">{line.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!all && notes.length > NOTES && (
        <button
          type="button"
          className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAll(true)}
        >
          Show all {notes.length}
        </button>
      )}
    </div>
  )
}

/** The arrow up in a circle (ADR 0072, decision 2): drawn to the share
 * that is down, whole once a version is ready, a short arc running round
 * while Banda looks, dashed with nothing new, a `!` when it failed, and a
 * check once Banda updated. globals.css moves it by `data-update-icon`. */
function UpdateIcon({ update }: { update: Update }) {
  const around = 2 * Math.PI * 9.5
  const share =
    update.state === "downloading"
      ? update.share
      : update.state === "looking"
        ? 0.22
        : 1
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-update-icon={update.state}
      className="size-4.5 shrink-0 overflow-visible"
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
