/**
 * What the Banda menu finds of the apps module (ADR 0022, decision 4):
 * the screens of the Apps this machine's engine runs, by the App's name.
 * Enter opens one in the Project the menu looks in.
 */
import { useRead } from "@banda/ui/hooks/use-read"
import type { FindProps, MenuRow, Source } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { AppWindowIcon } from "lucide-react"
import { useLayoutEffect, useMemo } from "react"
import { nameOf, viewPane } from "./ViewPane"

/** The view an App's name alone opens. */
const HOME = "home"

export const screensSource: Source = {
  id: "apps.screens",
  label: "Apps",
  Find: FindScreens,
}

function FindScreens({ words, at, found }: FindProps) {
  const { engine, project } = at
  // Read as the Person starts to type, each time: an App may have been
  // installed or removed since the menu was last used. The sources are
  // drawn while the menu is shut too, and then it reads nothing.
  const typing = words !== ""
  const read = useMemo(
    () => (typing ? () => engine.call("apps.describe", {}) : null),
    [engine, typing]
  )
  const apps = useRead(read)
  const rows = useMemo((): MenuRow[] => {
    if (!typing || apps.state !== "ready") return []
    const typed = words.toLowerCase()
    return apps.value.flatMap((app) =>
      app.methods
        .filter((method) => method.kind === "view")
        .map((method) => ({
          view: method.name,
          about: method.about,
          // A screen's name: the App's, and its view's when it is not
          // its home.
          title:
            method.name === HOME
              ? nameOf(app.id)
              : `${nameOf(app.id)}: ${method.name}`,
        }))
        .filter((screen) => screen.title.toLowerCase().includes(typed))
        .map((screen): MenuRow => ({
          id: `apps.screen.${app.id}.${screen.view}`,
          title: screen.title,
          detail: screen.about,
          icon: <AppWindowIcon />,
          run: (window) =>
            window.open(
              paneOf(viewPane, { app: app.id, view: screen.view }),
              project,
              { again: false }
            ),
        }))
    )
  }, [apps, words, typing, project])
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}
