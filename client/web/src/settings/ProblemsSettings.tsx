/**
 * The Problems section (ADR 0039, decision 1): what broke in Banda
 * itself, the newest first, as the engine keeps it on this computer. A
 * Problem opens to where it broke, and its report copies for an issue or
 * an Agent. A dot marks the ones new since the section was last open.
 */
import { useEffect, useState } from "react"
import type { Engine } from "@banda/contract"
import type { Problem } from "@banda/contract/problems"
import { Button } from "@banda/ui/components/button"
import { Empty, EmptyDescription, EmptyTitle } from "@banda/ui/components/empty"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { clock } from "@banda/core/react"
import { PLACES, useProblems } from "../problems/live"
import { lookingInto } from "../problems/look"
import type { SectionProps } from "./sections"
import { Group, Rows } from "./SettingRow"

/** Where the window keeps when the section was last open. */
const SEEN = "banda.problems.seen"

export function ProblemsSettings({ engine, lit, run }: SectionProps) {
  const live = useProblems(engine)
  // A new Thread is the agents module's action, as its key's.
  const lookInto =
    run &&
    ((fingerprint: string) =>
      void lookingInto(engine, fingerprint)
        .then((thread) => run("thread.new", thread))
        .catch(() => undefined))
  // What was new stays marked while the section is open.
  const [seen] = useState(() => Number(localStorage.getItem(SEEN)) || 0)
  useEffect(() => {
    if (live.state === "ready") localStorage.setItem(SEEN, String(Date.now()))
  }, [live])
  const [pick, setPick] = useState<{ lit?: string; open?: string }>()
  const open = pick && pick.lit === lit ? pick.open : lit

  if (live.state === "loading") return <Spinner />
  if (live.state === "refused")
    return <p className="text-sm text-destructive">{live.refusal.message}</p>
  const { problems } = live.view
  if (problems.length === 0)
    return (
      <Rows>
        <Empty>
          <EmptyTitle>Nothing broke</EmptyTitle>
          <EmptyDescription>
            If something in Banda breaks, it shows here, kept on this computer.
          </EmptyDescription>
        </Empty>
      </Rows>
    )
  return (
    <div className="flex flex-col gap-3">
      <Group
        title={
          problems.length === 1 ? "1 problem" : `${problems.length} problems`
        }
      >
        <Rows>
          {problems.map((problem) => (
            <ProblemRow
              key={problem.fingerprint}
              engine={engine}
              problem={problem}
              fresh={problem.first > seen}
              open={open === problem.fingerprint}
              onLookInto={lookInto && (() => lookInto(problem.fingerprint))}
              onToggle={() =>
                setPick({
                  lit,
                  open:
                    open === problem.fingerprint
                      ? undefined
                      : problem.fingerprint,
                })
              }
            />
          ))}
        </Rows>
      </Group>
      <p className="px-1 text-xs text-muted-foreground">
        A report holds what broke, where it broke, the system, and the last log
        lines. Your Panes appear by kind only, never by what they show.
      </p>
    </div>
  )
}

function ProblemRow({
  engine,
  problem,
  fresh,
  open,
  onLookInto,
  onToggle,
}: {
  engine: Engine
  problem: Problem
  fresh: boolean
  open: boolean
  /** Asks an Agent about it in a new Thread; none where no window runs
   * actions. */
  onLookInto?: () => void
  onToggle: () => void
}) {
  const [copied, setCopied] = useState<"copied" | "failed">()
  useEffect(() => {
    if (!copied) return
    const gone = setTimeout(() => setCopied(undefined), 1500)
    return () => clearTimeout(gone)
  }, [copied])
  const copy = async () => {
    try {
      const report = await engine.call("problems.problem", {
        fingerprint: problem.fingerprint,
      })
      await navigator.clipboard.writeText(report.text)
      setCopied("copied")
    } catch {
      setCopied("failed")
    }
  }
  const when = [
    `In ${PLACES[problem.source]}`,
    clock(problem.last),
    ...(problem.times > 1 ? [`first ${clock(problem.first)}`] : []),
    `Banda ${problem.version}`,
  ].join(" · ")
  return (
    <div
      data-key={problem.fingerprint}
      className={cn("flex flex-col", open && "bg-muted/50")}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-label={fresh ? "New" : undefined}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            fresh ? "bg-primary" : "bg-transparent"
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {problem.kind}{" "}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {problem.message}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{when}</span>
        </span>
        <span className="min-w-8 text-right text-xs text-muted-foreground tabular-nums">
          ×{problem.times}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 pr-3 pb-3 pl-7">
          {problem.frames.length > 0 && (
            <ol className="rounded-control bg-muted px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {problem.frames.map((frame, n) => (
                <li key={n} className={cn(n === 0 && "text-foreground")}>
                  {frame.file}
                  {frame.line !== undefined && `:${frame.line}`}
                  {frame.function && ` in ${frame.function}`}
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-1.5">
            {onLookInto && (
              <Button size="sm" onClick={onLookInto}>
                Look into it
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied === "copied" ? "Copied" : "Copy report"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.banda?.problems.logs()}
            >
              Open logs folder
            </Button>
            {copied === "failed" && (
              <span role="alert" className="text-xs text-destructive">
                The report could not be copied.
              </span>
            )}
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {problem.fingerprint}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
