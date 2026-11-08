/**
 * What the Banda menu finds of the files module (ADR 0022, decision 4;
 * ADR 0073, decision 11): the focused Project's files that fit the words,
 * as `files.find` matches them. Enter opens one in `files.file`, at the
 * line typed after them, as `main.rs:42`; Tab also offers Quick Look over
 * the desk, to show it in Files, in its folder, and to add it to a
 * Thread's message. Quick open (Alt+P, the mod with P) shows them alone,
 * what was opened lately first before a word is typed.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { copyText } from "@banda/ui/lib/clipboard"
import { named } from "@banda/ui/lib/file-links"
import type { Key } from "@banda/ui/lib/keys"
import { nameAndFolder } from "@banda/ui/lib/paths"
import type { FindProps, MenuRow, Source } from "@banda/ui/module"
import { FileIcon } from "lucide-react"
import { openFile, peekFile } from "./FilePane"
import { openTree } from "./TreePane"

const OPEN: Key = { code: "Enter" }
/** How many files a search shows; alone, as quick open shows them. */
const SHOWN = 6
const ALONE = 20
/** How long the typing rests before the files are asked for, in ms. */
const WAIT = 80

/** The focused Project's files that fit the words. */
export const filesSource: Source = {
  id: "files.find",
  label: "Files",
  Find: FindFiles,
}

function FindFiles({ words: typed, at, found }: FindProps) {
  const { engine, project, folder, entered, only } = at
  // `main.rs:42` finds `main.rs`, and opens it at line 42.
  const { path: words, line = null } = named(typed)
  const alone = only === filesSource.id
  const look = !entered && (words !== "" || alone) && folder !== undefined
  // The paths found last stay while the next are asked for.
  const [paths, setPaths] = useState<string[]>()
  useEffect(() => {
    if (!look) return
    let gone = false
    const timer = setTimeout(() => {
      engine.call("files.find", { query: words }, { project }).then(
        (found) => gone || setPaths(found.paths),
        () => gone || setPaths([])
      )
    }, WAIT)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [engine, project, words, look])
  const shown = look ? paths : undefined
  const rows = useMemo(
    (): MenuRow[] =>
      (shown ?? []).slice(0, alone ? ALONE : SHOWN).map((path) => {
        const full = `${(folder ?? "").replace(/\/$/, "")}/${path}`
        const { name, folder: inside } = nameAndFolder(path)
        const open: MenuRow["run"] = (window) =>
          openFile(window, full, line, project)
        const show: MenuRow["run"] = (window) =>
          openTree(
            window,
            { dir: nameAndFolder(full).folder ?? "/", selected: name },
            project,
            true
          )
        return {
          id: `files.file.${project}.${path}`,
          title: line ? `${name}:${line}` : name,
          detail: inside,
          icon: <FileIcon className="size-4 shrink-0 text-muted-foreground" />,
          run: open,
          acts: [
            { title: "Open", key: OPEN, run: open },
            {
              title: "Quick Look",
              run: (window) => peekFile(window, full, project),
            },
            { title: "Show in Files", run: show },
            {
              title: "Add to chat",
              run: (window) => window.attach({ path: full }),
            },
            { title: "Copy path", run: () => copyText(full) },
          ],
        }
      }),
    [shown, folder, project, line, alone]
  )
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}
