/**
 * Banda's own update on the bar's right (ADR 0041, decision 4): an arrow
 * in a circle, in the bar's muted text, only while there is something to
 * say. The circle fills as a version downloads, once that has run two
 * seconds, and is whole once the version is ready; a click shows what
 * changed and restarts into it. In `--destructive` only when the Person
 * has to mend something.
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
import { cn } from "@banda/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"
import type { Update } from "../host"
import { lineOf, SHOW_AFTER, shortOf, workingWords } from "./updating"

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
  if (!update || update.state === "none") return null
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
        <UpdateIcon share={update.state === "downloading" ? update.share : 1} />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <About update={update} working={working} />
      </PopoverContent>
    </Popover>
  )
  return update.state === "downloading" ? (
    <After ms={SHOW_AFTER}>{widget}</After>
  ) : (
    widget
  )
}

/** What the popover says. */
function About({ update, working }: { update: Update; working: number }) {
  if (update.state === "ready") {
    const later = update.notes.length - NOTES
    const warning = workingWords(working)
    return (
      <>
        <PopoverTitle>
          {update.name} {update.version}
        </PopoverTitle>
        <PopoverDescription>
          You have {update.have} · it installs when you quit {update.name}
        </PopoverDescription>
        {update.notes.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {update.notes.slice(0, NOTES).map((note) => (
              <li key={note.version} className="flex gap-2 text-xs">
                <span className="w-12 shrink-0 font-mono text-muted-foreground">
                  {shortOf(note.version)}
                </span>
                <span className="min-w-0">{note.text}</span>
              </li>
            ))}
            {later > 0 && (
              <li className="text-xs text-muted-foreground">
                and {later} more
              </li>
            )}
          </ul>
        )}
        {warning && <p className="mt-2 text-xs text-attention">{warning}</p>}
        <div className="mt-2 flex justify-end gap-1.5">
          <PopoverClose render={<Button variant="ghost" size="sm" />}>
            Later
          </PopoverClose>
          <PopoverClose
            render={<Button size="sm" />}
            onClick={() => window.banda?.update.restart()}
          >
            Restart
          </PopoverClose>
        </div>
      </>
    )
  }
  if (update.state === "failed")
    return (
      <>
        <PopoverTitle>{update.name} cannot update itself</PopoverTitle>
        <PopoverDescription>{update.reason}</PopoverDescription>
      </>
    )
  if (update.state !== "downloading") return null
  return (
    <>
      <PopoverTitle>
        {update.name} {update.version}
      </PopoverTitle>
      <PopoverDescription>{lineOf(update)}</PopoverDescription>
    </>
  )
}

/** The arrow up in a circle that is drawn to `share`, whole at 1. */
function UpdateIcon({ share }: { share: number }) {
  const around = 2 * Math.PI * 10
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
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
        strokeDasharray={around}
        strokeDashoffset={around * (1 - share)}
        transform="rotate(-90 12 12)"
        className="transition-[stroke-dashoffset]"
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
