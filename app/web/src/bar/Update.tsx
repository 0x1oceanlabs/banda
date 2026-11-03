/**
 * Banda's own update on the bar's right (ADR 0041, decision 4): an arrow
 * in a circle, in the bar's muted text, only while there is something to
 * say. The circle fills as a version downloads, once that has run two
 * seconds, and is whole once the version is ready; a click shows what
 * changed and restarts into it. In `--destructive` only when the Person
 * has to mend something. Banda Dev's stays on the bar, dimmed, with
 * "Update now" (ADR 0045).
 */
import { Button } from "@banda/ui/components/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import { useNow } from "@banda/ui/hooks/use-now"
import { cn } from "@banda/ui/lib/utils"
import { MINUTE } from "@banda/ui/lib/words"
import { type ReactNode, useEffect, useState } from "react"
import type { Note, Update } from "../host"
import {
  downloadWords,
  lineOf,
  lookedWords,
  SHOW_AFTER,
  shortOf,
  workingWords,
} from "./updating"

/** The notes the popover lists before it says how many more there are. */
const NOTES = 5

/** Where Banda's own update is, as main tells it; none outside the
 * desktop. */
function useUpdate(): Update | undefined {
  const [update, setUpdate] = useState<Update>()
  useEffect(() => {
    const host = window.banda?.update
    if (!host) return
    let live = true
    host.current().then(
      (now) => live && setUpdate(now),
      () => {}
    )
    const stop = host.listen(setUpdate)
    return () => {
      live = false
      stop()
    }
  }, [])
  return update
}

/** The update's widget; `working` is how many Threads work now. */
export function UpdateWidget({ working }: { working: number }) {
  const update = useUpdate()
  if (!update || (update.state === "none" && !update.always)) return null
  const widget = (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={lineOf(update)}
            title={lineOf(update)}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              update.state === "failed" &&
                "text-destructive hover:text-destructive"
            )}
          />
        }
      >
        <UpdateIcon update={update} />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <About update={update} working={working} />
      </PopoverContent>
    </Popover>
  )
  // Banda Dev's widget is there all along, its popover maybe open: it
  // does not hide while a download starts.
  return update.state === "downloading" && !update.always ? (
    <After ms={SHOW_AFTER}>{widget}</After>
  ) : (
    widget
  )
}

/** What the popover says. */
function About({ update, working }: { update: Update; working: number }) {
  const at = useNow(MINUTE)
  const warning = workingWords(working)
  if (update.state === "ready")
    return (
      <>
        <PopoverTitle>
          {update.name} {update.version}
        </PopoverTitle>
        <PopoverDescription>
          You have {update.have} · it installs when you quit {update.name}
        </PopoverDescription>
        <Notes notes={update.notes} />
        <Warning words={warning} />
        <div className="mt-2 flex justify-end gap-1.5">
          <Later />
          <PopoverClose
            render={<Button size="sm" />}
            onClick={() => window.banda?.update.restart()}
          >
            Restart
          </PopoverClose>
        </div>
      </>
    )
  if (update.state === "failed")
    return (
      <>
        <PopoverTitle>{update.name} cannot update itself</PopoverTitle>
        <PopoverDescription>{update.reason}</PopoverDescription>
      </>
    )
  if (update.state === "downloading")
    return (
      <>
        <PopoverTitle>
          {update.name} {update.version}
        </PopoverTitle>
        <PopoverDescription>{downloadWords(update)}</PopoverDescription>
        <Notes notes={update.notes} />
        {update.restarts && <Warning words={warning} />}
        <div className="mt-2 flex justify-end gap-1.5">
          {update.restarts ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.banda?.update.later()}
            >
              Don't restart
            </Button>
          ) : (
            <UpdateNow />
          )}
        </div>
      </>
    )
  // Nothing new known, or a look the Person asked for.
  const looking = update.state === "looking"
  return (
    <>
      <PopoverTitle>
        {update.name} {update.have}
      </PopoverTitle>
      <PopoverDescription className="line-clamp-3 break-words">
        {looking ? lineOf(update) : lookedWords(update, at)}
      </PopoverDescription>
      <div className="mt-2 flex justify-end gap-1.5">
        {!looking && <Later />}
        <UpdateNow disabled={looking} />
      </div>
    </>
  )
}

/** That a restart stops the turns of the Threads that work, if any do. */
function Warning({ words }: { words: string | undefined }) {
  return words ? <p className="mt-2 text-xs text-attention">{words}</p> : null
}

/** Closes the popover, and leaves the update as it is. */
function Later() {
  return (
    <PopoverClose render={<Button variant="ghost" size="sm" />}>
      Later
    </PopoverClose>
  )
}

/** Looks, downloads and restarts into a new version (ADR 0045); the
 * popover stays open to show how it goes. */
function UpdateNow({ disabled = false }: { disabled?: boolean }) {
  return (
    <Button
      size="sm"
      disabled={disabled}
      onClick={() => window.banda?.update.now()}
    >
      Update now
    </Button>
  )
}

/** What changed, newest first, and how many more there are. */
function Notes({ notes }: { notes: readonly Note[] }) {
  if (notes.length === 0) return null
  const later = notes.length - NOTES
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {notes.slice(0, NOTES).map((note) => (
        <li key={note.version} className="flex gap-2 text-xs">
          <span className="w-12 shrink-0 font-mono text-muted-foreground">
            {shortOf(note.version)}
          </span>
          <span className="min-w-0">{note.text}</span>
        </li>
      ))}
      {later > 0 && (
        <li className="text-xs text-muted-foreground">and {later} more</li>
      )}
    </ul>
  )
}

/** The arrow up in a circle: drawn to the share that is down, whole once
 * a version is ready, a turning arc while Banda looks, and dashed and
 * dim with nothing new (ADR 0045). */
function UpdateIcon({ update }: { update: Update }) {
  const around = 2 * Math.PI * 10
  const share =
    update.state === "downloading"
      ? update.share
      : update.state === "looking"
        ? 0.25
        : 1
  const idle = update.state === "none"
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4", idle && "opacity-55")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {share < 1 && <circle cx="12" cy="12" r="10" className="opacity-25" />}
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeDasharray={idle ? "3 3" : around}
        strokeDashoffset={idle ? 0 : around * (1 - share)}
        transform="rotate(-90 12 12)"
        className={cn(
          "origin-center transition-[stroke-dashoffset]",
          update.state === "looking" && "animate-spin"
        )}
      />
      <path d="m16 12-4-4-4 4M12 16V8" />
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
