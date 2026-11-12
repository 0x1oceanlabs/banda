/**
 * The Thread's divider where it moved to another account or Harness (ADR
 * 0078, decisions 4 and 5), as the accounts mockup draws it: a thin line
 * with both emblems. A handoff to another Harness unfolds what went, what
 * was left out and what did not go. A Thread that came from another
 * machine, where its Harness's session stayed, is handed its history by
 * the same account (ADR 0116, decision 5): the line names it once.
 */
import { useState } from "react"
import { ArrowRightIcon } from "lucide-react"
import { Emblem, emblemOf } from "@banda/ui/components/emblem"
import { useHarnesses } from "@banda/ui/hooks/use-harnesses"
import { useThreadAround } from "../thread/context"
import type { EntryProps } from "./types"

export function MovedEntry({ item }: EntryProps<"moved">) {
  const { engine } = useThreadAround()
  const harnesses = useHarnesses(engine)
  const [open, setOpen] = useState(false)
  const { from, to, how } = item.body
  const was = emblemOf(harnesses, from)
  const now = emblemOf(harnesses, to)
  const handed = how.kind === "same" ? undefined : how
  // The same account on another machine: a session of its own here.
  const here = from === to && how.kind === "handoff"
  // A Thread with nothing before its move hands nothing: a new session.
  const unfolds = how.kind === "handoff" && how.messages + how.tools > 0
  const what =
    how.kind === "same"
      ? "same session"
      : how.kind === "back"
        ? `back to its session · ${plural(how.messages + how.tools, "new entry", "new entries")}`
        : unfolds
          ? `${here ? "a new session here · " : ""}handed ${plural(how.messages, "message", "messages")}`
          : "a new session"
  const line = (
    <>
      {!here && (
        <>
          <Emblem of={was} named />
          <ArrowRightIcon className="size-3 text-muted-foreground/70" />
        </>
      )}
      <Emblem of={now} named />
      <span className="text-muted-foreground/70">· {what}</span>
      {unfolds && (
        <span className="text-muted-foreground/70">{open ? "▾" : "▸"}</span>
      )}
    </>
  )
  return (
    <div className="my-1">
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        {unfolds ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 whitespace-nowrap hover:bg-accent hover:text-foreground"
          >
            {line}
          </button>
        ) : (
          <span
            title={
              how.kind === "same"
                ? "Its first turn here reads the Thread without the cache."
                : how.kind === "handoff"
                  ? `${now.name} started a session of its own: there was nothing before to hand it.`
                  : `${was.name} went on with its own session, and read only what it missed.`
            }
            className="inline-flex items-center gap-1.5 px-2 py-0.5 whitespace-nowrap"
          >
            {line}
          </span>
        )}
      </div>
      {open && handed && (
        <dl className="mx-auto mt-2 grid max-w-xl grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 rounded-control border px-3 py-2 text-xs text-muted-foreground">
          <dt className="text-muted-foreground/70">Went</dt>
          <dd>
            {plural(handed.messages, "message", "messages")},{" "}
            {plural(handed.tools, "tool call", "tool calls")} as text · ≈
            {thousands(handed.tokens)} tokens
          </dd>
          <dt className="text-muted-foreground/70">Left out</dt>
          <dd>
            {handed.left_out === 0
              ? "nothing"
              : `${plural(handed.left_out, "earlier entry", "earlier entries")}: the Agent reads them with read when it needs them`}
          </dd>
          <dt className="text-muted-foreground/70">Did not go</dt>
          <dd>{was.name}'s hidden reasoning, its cache, its tools' state</dd>
          {!here && (
            <>
              <dt className="text-muted-foreground/70">Back</dt>
              <dd>
                on {was.name} its session goes on, and gets only what is new
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** 14200 as "14k", 800 as "800". */
function thousands(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}k`
}
