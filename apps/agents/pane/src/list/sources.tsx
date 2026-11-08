/**
 * What the Banda menu finds of the agents module (ADR 0022, decision 4):
 * a new Thread with the words typed. Its Threads are the sidebar's lists,
 * which the window finds itself; the files module finds the files.
 */
import { useLayoutEffect, useMemo } from "react"
import { Emblem } from "@banda/ui/components/emblem"
import type { FindProps, MenuRow, Source } from "@banda/ui/module"
import { SquarePenIcon } from "lucide-react"
import { useHarnesses } from "../harnesses"

/** New Thread with the words, on the first Harness or, by `Tab`, on any;
 * in a Project gone into, a new Thread there. */
export const askSource: Source = { id: "agents.ask", label: "", Find: FindAsk }

function FindAsk({ words, at, found }: FindProps) {
  const { engine, project, entered } = at
  const all = useHarnesses(engine)
  const rows = useMemo((): MenuRow[] => {
    if (!entered && !words) return []
    // A Harness turned off starts no new Thread.
    const harnesses = all.filter((harness) => harness.enabled)
    const first = harnesses[0]
    const start = (harness?: string) => ({
      project,
      ...(words && { ask: words }),
      ...(harness && { harness }),
    })
    return [
      {
        id: entered ? `agents.ask.${project}` : "agents.ask",
        title: words ? `New Thread: “${words}”` : "New Thread here",
        icon: first ? (
          <Emblem of={first} className="size-4" />
        ) : (
          <SquarePenIcon className="size-4 shrink-0" />
        ),
        detail: first?.name,
        run: (window) => window.run("thread.new", start()),
        acts: harnesses.map((harness) => ({
          title: `Start on ${harness.name}`,
          run: (window) => window.run("thread.new", start(harness.id)),
        })),
      },
    ]
  }, [all, entered, words, project])
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}
