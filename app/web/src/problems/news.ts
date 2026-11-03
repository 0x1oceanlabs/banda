/**
 * A new Problem tells the Person once, silently, where they will notice
 * it (ADR 0039, decision 1, after ADR 0011): a toast while the window is
 * in front, a system notification while it is not, nothing while the
 * desktop is quiet or `[notify] problems` is off. Only a Problem new
 * since the window last told of one tells: one that breaks again counts.
 */
import { useCallback, useEffect, useRef } from "react"
import type { Engine } from "@banda/contract"
import type { Notify } from "@banda/contract/look"
import type { Problem } from "@banda/contract/problems"
import type { Host } from "../host"
import { quietNow } from "../calls/system"
import { placeOf } from "../calls/tell"
import { told } from "../calls/toast"
import { useToasts } from "../calls/useToasts"
import { PLACES, useProblems } from "./live"

/** The key of a Problem's system notification. */
export const NOTICE = "problem:"

/** Where the window keeps when it last told of a Problem. */
const TOLD = "banda.problems.told"

export type ProblemNews = {
  /** The newest Problem a toast tells of, and how many more came with it:
   * one toast for them all, as each opens the same section. */
  shown?: { problem: Problem; more: number }
  /** The Person saw them: the toast goes. */
  dismiss: () => void
  /** The pointer holds the toast, or lets it go. */
  hold: (holds: boolean) => void
}

export function useProblemNews(
  engine: Engine,
  notify: Notify,
  front: () => boolean,
  desktop: Host["notify"] | undefined
): ProblemNews {
  const live = useProblems(engine)
  const settings = useRef({ notify, desktop })
  useEffect(() => {
    settings.current = { notify, desktop }
  }, [notify, desktop])
  const { toasts, setToasts, hold } = useToasts()
  const problems = live.state === "ready" ? live.view.problems : []

  useEffect(() => {
    if (live.state !== "ready") return
    const before = Number(localStorage.getItem(TOLD))
    const news = before
      ? live.view.problems.filter((problem) => problem.first > before)
      : []
    const newest = Math.max(before, ...live.view.problems.map((p) => p.first))
    // The first time, what already broke is no news.
    localStorage.setItem(TOLD, String(newest || Date.now()))
    if (news.length === 0) return
    void tellOf(news, front(), settings.current).then((toast) => {
      if (!toast) return
      const now = Date.now()
      setToasts((toasts) =>
        news.reduceRight(
          (all, problem) => told(all, problem.fingerprint, "failed", now),
          toasts
        )
      )
    })
  }, [live, front, setToasts])

  const dismiss = useCallback(() => setToasts([]), [setToasts])
  const shown = toasts.flatMap((toast) => {
    const problem = problems.find((one) => one.fingerprint === toast.key)
    return problem ? [problem] : []
  })
  return {
    ...(shown[0] && { shown: { problem: shown[0], more: shown.length - 1 } }),
    dismiss,
    hold,
  }
}

/** Tells of `news` on the desktop when that is where; whether a toast
 * should tell of them instead. */
async function tellOf(
  news: Problem[],
  inFront: boolean,
  { notify, desktop }: { notify: Notify; desktop?: Host["notify"] }
): Promise<boolean> {
  if (!notify.problems) return false
  const sight = inFront ? "in-window" : "away"
  const place = placeOf(sight, notify, await quietNow(notify, desktop))
  if (!place) return false
  if (place.system && desktop)
    for (const problem of news)
      desktop.show({
        key: `${NOTICE}${problem.fingerprint}`,
        title: "Something broke in Banda",
        body: `${problem.kind} in ${PLACES[problem.source]}. Click to look into it.`,
        answer: "Details",
        lasts: false,
      })
  return place.toast
}
