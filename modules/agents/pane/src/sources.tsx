/**
 * What the Banda menu finds of the agents module (ADR 0022, decision 4):
 * a new Thread with the words typed, and the focused Space's files that
 * fit them, as `@` finds them. Its Threads are the sidebar's lists, which
 * the window finds itself.
 */
import { useLayoutEffect, useMemo } from "react"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import type { Key } from "@banda/ui/lib/keys"
import { nameAndFolder } from "@banda/ui/lib/paths"
import type { FindProps, MenuRow, Source } from "@banda/ui/module"
import { FileIcon, SquarePenIcon } from "lucide-react"
import { useSpaceFiles } from "./FileMenu"
import { useHarnesses } from "./harnesses"

const OPEN: Key = { code: "Enter" }

/** How many files a search shows. */
const SHOWN = 6

/** New Thread with the words, on the first Harness or, by `Tab`, on any;
 * in a Space gone into, a new Thread there. */
export const askSource: Source = { id: "agents.ask", label: "", Find: FindAsk }

/** The focused Space's files that fit the words; one opens in a browser. */
export const filesSource: Source = {
  id: "agents.files",
  label: "Files",
  Find: FindFiles,
}

function FindAsk({ words, here, found }: FindProps) {
  const { engine, space, entered } = here
  const all = useHarnesses(engine, space)
  const rows = useMemo((): MenuRow[] => {
    if (!entered && !words) return []
    // A Harness turned off starts no new Thread.
    const harnesses = all.filter((harness) => harness.enabled)
    const first = harnesses[0]
    const start = (harness?: string) => ({
      space,
      ...(words && { ask: words }),
      ...(harness && { harness }),
    })
    return [
      {
        id: entered ? `agents.ask.${space}` : "agents.ask",
        title: words ? `New Thread: “${words}”` : "New Thread here",
        icon: (
          <HarnessLogo
            id={first?.id}
            name={first?.name ?? ""}
            className="size-4"
            fallback={<SquarePenIcon className="size-4 shrink-0" />}
          />
        ),
        detail: first?.name,
        run: (window) => window.run("thread.new", start()),
        acts: harnesses.map((harness) => ({
          title: `Start on ${harness.name}`,
          run: (window) => window.run("thread.new", start(harness.id)),
        })),
      },
    ]
  }, [all, entered, words, space])
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}

function FindFiles({ words, here, found }: FindProps) {
  const { engine, space, folder, entered } = here
  const look = !entered && words !== "" && folder !== undefined
  const files = useSpaceFiles(engine, space, look ? words : undefined)
  const paths = look ? files?.paths : undefined
  const rows = useMemo(
    (): MenuRow[] =>
      (paths ?? []).slice(0, SHOWN).map((path) => {
        const full = `${(folder ?? "").replace(/\/$/, "")}/${path}`
        const { name, folder: inside } = nameAndFolder(path)
        const open: MenuRow["run"] = (window) =>
          window.run("browser.open", { file: full, space })
        return {
          id: `agents.file.${space}.${path}`,
          title: name,
          detail: inside,
          icon: <FileIcon className="size-4 shrink-0 text-muted-foreground" />,
          run: open,
          acts: [
            { title: "Open", key: OPEN, run: open },
            {
              title: "Copy path",
              run: () =>
                void navigator.clipboard
                  .writeText(full)
                  .catch((error: unknown) => console.error("copy:", error)),
            },
          ],
        }
      }),
    [paths, folder, space]
  )
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}
