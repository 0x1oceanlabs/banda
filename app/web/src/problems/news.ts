/**
 * A new Problem tells the Person once, silently, where they will notice
 * it (ADR 0039, decision 1, after ADR 0011): a toast while the window is
 * in front, a system notification while it is not, nothing while the
 * desktop is quiet or `[notify] problems` is off. Only a Problem new
 * since the window last told of one tells: one that breaks again counts.
 */
import { useEffect, useRef } from "react"
import type { Engine } from "@banda/contract"
import type { Notify } from "@banda/contract/look"
import type { Problem } from "@banda/contract/problems"
import type { Host } from "../host"
import { quietNow } from "../calls/system"
import { placeOf } from "../calls/tell"
import { PLACES, useProblems } from "./live"
import { type ProblemAnswers, toastProblems } from "./problemToast"

/** The key of a Problem's system notification. */
export const NOTICE = "problem:"

/** Where the window keeps when it last told of a Problem. */
const TOLD = "banda.problems.told"

export function useProblemNews(
  engine: Engine,
  notify: Notify,
  front: () => boolean,
  desktop: Host["notify"] | undefined,
  answers: ProblemAnswers
): void {
  const live = useProblems(engine)
  const settings = useRef({ notify, desktop, answers })
  useEffect(() => {
    settings.current = { notify, desktop, answers }
  }, [notify, desktop, answers])

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
      if (toast) toastProblems(news, settings.current.answers)
    })
  }, [live, front])
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
