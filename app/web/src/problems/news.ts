/**
 * A new Problem tells the Person once, silently, where they will notice
 * it (ADR 0039, decision 1, after ADR 0011): the notifications module
 * tells it (ADR 0056, decision 2), unless `[notify] problems` is off.
 * Only a Problem new since the window last told of one tells: one that
 * breaks again counts.
 */
import { useEffect, useRef } from "react"
import type { Engine } from "@banda/contract"
import type { Notify } from "@banda/contract/look"
import type { Problem } from "@banda/contract/problems"
import type { Args } from "@banda/ui/module"
import { PLACES, problemLink, useProblems } from "./live"

/** Where the window keeps when it last told of a Problem. */
const TOLD = "banda.problems.told"

/**
 * What the notifications module tells of the new Problems: the newest,
 * in its words, how many more; Look into it, which asks an Agent in a new
 * Thread, and Details, which opens it in Settings → Problems, as a click
 * on the desktop's notification does.
 */
export function toldOf(news: readonly Problem[]): Args {
  const problem = news[0]!
  const more = news.length - 1
  const { fingerprint } = problem
  const where = PLACES[problem.source]
  return {
    key: "problems",
    kind: "failed",
    title: "Something broke in Banda",
    code: `${problem.kind}: ${problem.message}`,
    body:
      `In ${where}.` +
      (more > 0 ? ` ${more} more ${more === 1 ? "is" : "are"} new.` : "") +
      " Kept in Settings → Problems.",
    notice: `${problem.kind} in ${where}. Click to look into it.`,
    buttons: [
      {
        label: "Look into it",
        action: "problems.look-into",
        args: { fingerprint },
      },
      {
        label: "Details",
        action: "settings.open",
        args: { link: problemLink(fingerprint) },
      },
    ],
    click: 1,
    silent: true,
  }
}

export function useProblemNews(
  engine: Engine,
  notify: Notify,
  run: (action: string, args: Args) => void
): void {
  const live = useProblems(engine)
  const settings = useRef({ notify, run })
  useEffect(() => {
    settings.current = { notify, run }
  }, [notify, run])

  useEffect(() => {
    if (live.state !== "ready") return
    const before = Number(localStorage.getItem(TOLD))
    const news = before
      ? live.view.problems.filter((problem) => problem.first > before)
      : []
    const newest = Math.max(before, ...live.view.problems.map((p) => p.first))
    // The first time, what already broke is no news.
    localStorage.setItem(TOLD, String(newest || Date.now()))
    if (news.length === 0 || !settings.current.notify.problems) return
    settings.current.run("notifications.tell", toldOf(news))
  }, [live])
}
