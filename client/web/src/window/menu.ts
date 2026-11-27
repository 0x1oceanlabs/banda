/**
 * The Banda menu as the Window opens it (ADR 0017): by its keys, and by
 * a route, from `banda menu ROUTE` or a link; and what a row chosen in it
 * does.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { HereStore, KeptHosts } from "@banda/core"
import { device } from "../boot"
import { openingIn } from "../menu/BandaMenu"
import {
  type At,
  type Branch,
  type Choice,
  type Opening,
  type Own,
  openingAt,
  settingsLinkOf,
} from "../menu/menu"
import { writeLook } from "../menu/theme"
import { sources } from "../registry"
import { writeSidebar } from "../sidebar"
import { runAction, type Shell } from "./actions"

/** The modules' sources, as a route names one for the menu to show alone. */
const menuSources = sources.map(({ source }) => source)

export function useMenuOpening(
  kept: KeptHosts,
  projects: readonly ProjectSummary[],
  /** Opens the settings at a link. */
  settings: (link: string) => void
) {
  const [menu, setMenu] = useState<Opening | null>(null)
  // Alt+Space or Alt+K again, or the other of them, closes the menu.
  const toggleMenu = useCallback(
    (at: At) => setMenu((open) => (open ? null : openingAt(at))),
    []
  )
  const closeMenu = useCallback(() => setMenu(null), [])
  // `banda menu ROUTE` opens the menu there (ADR 0017, decision 7).
  const projectsNow = useRef(projects)
  useEffect(() => {
    projectsNow.current = projects
  }, [projects])
  // A settings route opens the settings there; any other, the menu.
  const route = useCallback(
    (route: string) => {
      const link = settingsLinkOf(route)
      if (link === undefined)
        setMenu(openingIn(kept, route, projectsNow.current, menuSources))
      else settings(link)
    },
    [settings, kept]
  )
  useEffect(() => device.menu.listen(route), [route])
  // Whether a Project's folder is missing, as the list has it now.
  const missing = useCallback(
    (project: ProjectId) =>
      projectsNow.current.find((one) => one.id === project)?.missing === true,
    []
  )
  return { menu, toggleMenu, closeMenu, route, missing }
}

/** What a row chosen in the menu does. */
export function useChosen(
  parts: Shell,
  here: Pick<HereStore, "get">,
  newThreadIn: (project: ProjectId, ask?: string) => void
) {
  return useCallback(
    (row: Exclude<Choice, Branch | Own>) => {
      switch (row.kind) {
        case "thread":
          // A pick goes as the sidebar's does, and so does one brought
          // beside, as its Shift+Enter.
          return parts.run(row.beside ? "pane.beside" : "pane.pick", {
            project: row.project,
            pane: row.listed.pane,
          })
        case "action":
          return runAction(parts, row.action)
        case "ask":
          return newThreadIn(
            row.project ?? here.get().starts,
            row.words || undefined
          )
        case "item":
          return parts.run(row.action, {
            project: row.project,
            item: row.listed.id,
          })
        case "group":
          return writeSidebar(parts.writeSetting, "group", row.group)
        case "look":
          return writeLook(parts.writeSetting, row)
        case "found":
          return row.row.run(parts)
      }
    },
    [newThreadIn, parts, here]
  )
}
