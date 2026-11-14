/**
 * What the window does, as one list of actions (ADR 0005, decisions 2 and
 * 10): the modules' own, the Tiling's (`tiling/actions.ts`) and the
 * Window's (ADR 0022, decision 3; ADR 0087, decision 13). The keys, the
 * Banda menu, its key sheet and `keys.toml` read the same list.
 */
import type { Engine, ProjectId } from "@banda/contract"
import {
  type Act,
  type Hosts,
  type KeptHosts,
  linkOf,
  linkRefused,
  type Route,
  routeAct,
  type Store,
} from "@banda/core"
import { useState } from "react"
import type { TopAsked } from "./top"
import { toast } from "@banda/ui/components/sonner"
import { fileMint } from "@banda/ui/hooks/use-file-url"
import { THIS_COMPUTER } from "@banda/ui/lib/outside"
import { nameAndFolder } from "@banda/ui/lib/paths"
import { seenNamed } from "@banda/ui/hooks/use-status"
import { trustProject, updateProject } from "@banda/ui/lib/projects"
import { problem } from "@banda/ui/lib/words"
import {
  type Action,
  type Args,
  itemArgs,
  itemOf,
  scoped,
  takes,
  type WindowApi,
} from "@banda/ui/module"
import { IN_PROGRAM, type PaneState } from "@banda/ui/pane"
import { RESET_KEY } from "../actions/actions"
import { chipOf } from "./attach"
import { device } from "../boot"
import { quiet } from "../calls/quiet"
import { actAs, refused, type Routing } from "../tiling/mount"
import { type At, locateRoute } from "../menu/menu"
import { modules } from "../modules"
import { moduleAct, windowModule } from "../registry"
import { archiving } from "./items"
import { askTab, isTab, pickLater, SIDEBAR, SIDEBAR_KEYS } from "../sidebar"
import { makeProject } from "../titles/MakeProject"
import { askRemoval } from "../settings/RemoveProject"
import { notNow } from "../trust/not-now"
import { askTrust } from "../trust/TrustCard"
import { TILING_ACTIONS, type Tiling } from "../tiling/actions"

/** What the window's own actions can change: its parts, more than a
 * module's get (`WindowApi`), and what the Tiling's take (`Tiling`). */
export type Shell = WindowApi & {
  /** What the Top layer was asked to show of an App's (`WindowApi.top`),
   * which `TopPart` draws. */
  tops: Store<TopAsked>
  toggleSidebar: () => void
  /** Shows the sidebar, as a notice of many calls asks (ADR 0011). */
  showSidebar: () => void
  /** Drops the drawer, or lifts it (ADR 0025, decision 8). */
  drawer: () => void
  /** Opens the focused Pane in a window of its own, or brings it back to
   * its place (ADR 0025, decision 9). */
  popOut: () => void
  /** Goes to what calls the Person first (ADR 0011, decision 5). */
  answer: () => void
  /** Opens the Banda menu, or closes it when it is open (ADR 0017). */
  menu: (at: At) => void
  /** Has what peeks over the desk fill it, or float again (ADR 0073,
   * decision 7); false when nothing peeks. */
  fillPeek: () => boolean
  /** Opens the Banda menu at a route, or the settings at theirs, as
   * `banda menu ROUTE` does (ADR 0017, decision 7). */
  route: (route: string) => void
  /** The window's own keys again, until keys.toml changes; the settings
   * open at Keys to mend it (ADR 0005, decision 11). */
  ownKeys: () => void
  /** Opens the settings at `link`, a section and a row (ADR 0016). */
  settings: (link?: string, on?: string) => void
  /** Asks an Agent to look into a Problem, in a new Thread (ADR 0039). */
  lookInto: (fingerprint: string) => void
  /** Quits Banda: stops the engine and its Agents, asking first while
   * they work (ADR 0086, decision 3). */
  quit: () => void
  /** The engine, for what the window asks of it itself, as a title for a
   * Thread (ADR 0077). */
  engine: Engine
  /** The Window's hosts, by which the router places what an act acts on
   * (ADR 0106, law 3). */
  hosts: Hosts & Pick<KeptHosts, "reread">
} & Tiling

/** What a module is given of `shell`, a steady face of it (`useSteady`):
 * its `WindowApi` alone, so an App's `start` and its widgets reach no more
 * of the Window than the API says. */
export function windowApiOf(shell: Shell): WindowApi {
  return {
    get home() {
      return shell.home
    },
    open: shell.open,
    here: shell.here,
    beside: shell.beside,
    items: shell.items,
    run: shell.run,
    sessionOf: shell.sessionOf,
    waiting: shell.waiting,
    sight: shell.sight,
    projects: shell.projects,
    machines: shell.machines,
    top: shell.top,
    look: shell.look,
    quiet: shell.quiet,
    writeSetting: shell.writeSetting,
    attach: shell.attach,
    peek: shell.peek,
  }
}

/** What the modules are given of `shell`: the API alone, made once. */
export function useWindowApi(shell: Shell): WindowApi {
  const [api] = useState(() => windowApiOf(shell))
  return api
}

/** What a file action takes. */
const FILE = "the file's absolute path"

/** A toast of why a file act was not done, in its machine's words. */
function notDone(failure: unknown) {
  const said = failure instanceof Error ? failure.message : String(failure)
  refused({ runs: false, why: said, said })
}

/**
 * Does `then` with the file `args` name and its Project's ID, if the
 * file is there still, as the machine of that Project says (ADR 0106,
 * law 1): a toast says when it has gone since its link was drawn (ADR
 * 0063, decision 2). Where the args name no Project, it is the one the
 * Person is in. Part of the act, so while that machine is away the act
 * is refused whole and never done later by itself (law 4).
 */
function present(
  shell: Pick<Shell, "here" | "sessionOf">,
  args: Args | undefined,
  then: (file: string, project: ProjectId) => void
) {
  const file = args?.file
  if (typeof file !== "string") return
  const { here } = fromHere(shell)
  const project =
    typeof args?.project === "string"
      ? (args.project as ProjectId)
      : here.project
  let session: Engine
  try {
    // Here's Pane says only where a Project not listed yet is: the router
    // has weighed the act already and refused one that is no one's.
    session = shell.sessionOf(project, here.pane)
  } catch (failure) {
    return notDone(failure)
  }
  session
    .call("files.stat", { paths: [file] }, { project, once: true })
    .then(([stat]) => {
      if (stat) then(file, project)
      else toast.warning(`No such file: ${file}`)
    }, notDone)
}

/**
 * Saves a copy of `file`, of `project`, on this device (`file.save-copy`):
 * the Project's machine gives a token for its bytes, and the device fetches
 * them once the Person picked where. A machine away is said at once.
 */
function saveCopy(
  shell: Pick<Shell, "here" | "sessionOf">,
  file: string,
  project: ProjectId
) {
  const { name } = nameAndFolder(file)
  const mint = fileMint(
    shell.sessionOf(project, fromHere(shell).here.pane),
    project
  )
  void (mint?.(file) ?? Promise.resolve(null))
    .then((url) => {
      if (url === null) throw new Error(`${name} was not saved.`)
      return device.files.save(url, name)
    })
    .then((saved) => {
      if (saved === "saved") toast.success(`Saved a copy of ${name}`)
      else if (saved === "away")
        notDone(`${name} was not saved: its machine went away.`)
    }, notDone)
}

/** Does `then` with the device file `args` name, if it is there still,
 * for what reaches this device's disk alone; a toast
 * says when it has gone since its link was drawn (ADR 0063, decision 2).
 */
function presentHere(args: Args | undefined, then: (file: string) => void) {
  const file = args?.file
  if (typeof file !== "string") return
  void device.files.exists(file)?.then((there) => {
    if (there) then(file)
    else toast.warning(`No such file: ${file}`)
  })
}

/** The other machines a stop is on its way to, by their keys: a second
 * click meanwhile sends no second `banda stop`. */
const stopping = new Set<string>()

/**
 * Stops Banda on another machine, by its key in `hosts.toml` (ADR 0095,
 * decision 6): its own `banda stop` there. While its Agents work, nothing
 * stops; a toast asks once whether to stop them too. One stop at a time
 * goes to each, and one toast says of it.
 */
function stopHost(host: string, force = false) {
  if (stopping.has(host)) return
  stopping.add(host)
  const { name } = seenNamed(host)
  const id = `hosts.stop:${host}`
  device.hosts
    .stop(host, force)
    .then(
      (said) => {
        if (said === "working")
          toast(`Agents work on ${name}`, {
            id,
            description: "Stopping Banda there stops them too.",
            action: {
              label: "Stop anyway",
              onClick: () => stopHost(host, true),
            },
          })
      },
      (error: unknown) => {
        console.error(`banda: Banda on ${host} was not stopped`, error)
        toast.error(`Banda on ${name} was not stopped. Try again.`, { id })
      }
    )
    .finally(() => stopping.delete(host))
}

/** The Window's own actions (ADR 0071, decision 2; ADR 0087, decision
 * 13): `client/web/window.json` copies them for the engine. None is the
 * Tiling's, which declares its own (`TILING_ACTIONS`). */
export const WINDOW_ACTIONS: readonly Action<Shell>[] = [
  {
    // A web address from a Pane opens in this device's browser, and one
    // of another machine's own computer says it is that machine's (ADR
    // 0106, decision 3). It takes its address from a Pane alone: it
    // declares no `args`, so no line of keys.toml, the Person's or an
    // Agent's, can name one (ADR 0071, decision 3).
    id: "link.open",
    section: "Panes",
    title: "Open a link",
    unlisted: true,
    run: (_shell, args = {}) => {
      const link = typeof args.url === "string" ? linkOf(args.url) : undefined
      // Main hands an http(s) address to the system, and nothing else
      // leaves the page.
      if (link) window.open(link.url, "_blank", "noopener")
    },
  },
  {
    id: "pane.pop-out",
    section: "Panes",
    title: "The Pane in a window of its own, and back",
    run: (shell) => shell.popOut(),
  },
  {
    id: "drawer.toggle",
    section: "Threads",
    title: "The drawer: a quick Thread over the workspace",
    // As a terminal that drops down is: the key under Esc.
    keys: [{ code: "Backquote", mod: true }],
    overDialogs: true,
    run: (shell) => shell.drawer(),
  },
  {
    id: "calls.answer",
    section: "Threads",
    title: "Go to what calls you",
    keys: [{ code: "KeyU", mod: true }],
    run: (shell) => shell.answer(),
  },
  archiving,
  {
    // Threads' "Make a Project from it…" (ADR 0046): its dialog is the
    // Window's, for a Project of No Project alone, missing or not, as the
    // Thread menu shows its row.
    id: "project.make",
    args: takes({ project: "the No Project's Project its Thread is in" }, [
      "project",
    ]),
    section: "Threads",
    title: "Make a Project from a Thread in No Project",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.project === "string")
        makeProject(args.project as ProjectId)
    },
  },
  {
    // The Later's picker (ADR 0074, decision 5): the sidebar list's, as
    // a Thread's App asks it when.
    id: "sidebar.later-picker",
    args: itemArgs(),
    section: "Threads",
    title: "Pick when the Thread you look at wakes",
    unlisted: true,
    run: (shell, args) => {
      const at = itemOf(shell, args)
      pickLater(at && { thread: at })
    },
  },
  {
    id: "menu.open",
    section: "Banda",
    title: "Banda menu",
    keys: [{ code: "Space", mod: true }],
    overDialogs: true,
    // Over Quick Look its key has the tile fill the desk, or float again,
    // as ⌥Space does in a Finder (ADR 0073, decision 7, as amended): the
    // menu opens once Quick Look is closed. A module opens it on one of
    // its sources alone, as Files' quick open does.
    args: takes({
      source: "a source's id, to show its rows alone, as files.find",
    }),
    run: (shell, args) => {
      if (typeof args?.source === "string")
        return shell.route(`find.${args.source}`)
      if (!shell.fillPeek()) shell.menu("root")
    },
  },
  {
    id: "menu.keys",
    section: "Banda",
    title: "Every action and its key",
    keys: [{ code: "KeyK", mod: true }],
    overDialogs: true,
    run: (shell) => shell.menu("actions"),
  },
  {
    // The key sheet's button and a module's link: the menu opens there
    // whatever shows, as `banda menu` opens it. Alt+Space is
    // menu.open's, which fills Quick Look where it shows, and Alt+K
    // closes the menu at its Actions. A route is a row's id in the menu
    // (ADR 0017), not a client's Route to a host.
    id: "menu.at",
    args: takes({
      route:
        "a route of banda menu, as actions or project.add; none for its root",
    }),
    section: "Banda",
    title: "Open the Banda menu at a route",
    unlisted: true,
    run: (shell, args) =>
      shell.route(typeof args?.route === "string" ? args.route : ""),
  },
  {
    // A file a Pane's link names, as a terminal's path or a reply's
    // (ADR 0063), at its line: in Files' `files.file` (ADR 0073).
    id: "file.open",
    args: takes({ file: FILE, project: "the Project it is in" }, ["file"]),
    section: "Banda",
    title: "Open a file in Banda",
    unlisted: true,
    run: (shell, args) =>
      present(shell, args, (file, project) =>
        shell.run("files.open", {
          file,
          project,
          line: args?.line ?? null,
        })
      ),
  },
  {
    // A reply's path in Quick Look, over the desk (ADR 0073, decision 12):
    // in Files' `files.file`, as it peeks.
    id: "file.peek",
    args: takes({ file: FILE, project: "the Project it is in" }, ["file"]),
    section: "Banda",
    title: "Quick Look at a file",
    unlisted: true,
    run: (shell, args) =>
      present(shell, args, (file, project) =>
        shell.run("files.peek", { file, project })
      ),
  },
  {
    // A file a Pane's link names, as a terminal's path with Ctrl.
    id: "file.outside",
    args: takes({ file: FILE }, ["file"]),
    runsAsPerson: true,
    section: "Banda",
    title: "Open a file in its app",
    unlisted: true,
    run: (_, args) => presentHere(args, device.files.outside),
  },
  {
    // Files' "Add to chat" and a reply's "Add to message": the file named
    // in a Thread's message, as `@` names it; and a comment on some of
    // its lines, which the message quotes (ADR 0073, decisions 6 and 14).
    id: "file.attach",
    args: takes(
      {
        file: "the file's absolute path; a folder's ends with /",
        project: "the Project it is in",
        from: { number: "the first line commented on, from 1" },
        to: { number: "the last line commented on" },
        comment: "what the Person says of those lines",
        text: "those lines as they read",
      },
      ["file"]
    ),
    // The words go in the message, as the Person's.
    runsAsPerson: ["comment", "text"],
    section: "Banda",
    title: "Add a file to a Thread's message",
    unlisted: true,
    run: (shell, args) =>
      present(shell, args, (path, project) =>
        shell.attach(chipOf(path, args ?? {}, project))
      ),
  },
  {
    // Files' "Save a copy to this Mac", for a file of another machine's
    // (ADR 0106, decision 6): its machine gives the bytes, the device
    // saves them where the Person picks (`save_file`).
    id: "file.save-copy",
    args: takes({ file: FILE, project: "the Project it is in" }, ["file"]),
    runsAsPerson: true,
    section: "Banda",
    title: `Save a copy to ${THIS_COMPUTER}`,
    unlisted: true,
    run: (shell, args) =>
      present(shell, args, (file, project) => saveCopy(shell, file, project)),
  },
  {
    // A Thread menu's "Show in folder", for a path in a reply.
    id: "file.folder",
    args: takes({ file: FILE }, ["file"]),
    runsAsPerson: true,
    section: "Banda",
    title: "Show a file in its folder",
    unlisted: true,
    run: (_, args) => presentHere(args, device.files.show),
  },
  {
    // The menu's Paste, as a terminal's: the focused field takes it. Only
    // the Person runs it (ADR 0083, decision 3): what the clipboard holds
    // goes where the focus is, a shell among them, which would run it.
    id: "edit.paste",
    section: "Banda",
    title: "Paste",
    unlisted: true,
    runsAsPerson: true,
    run: () => device.edit.paste(),
  },
  {
    // The composer menu's "Paste as plain text"; the Person's, as Paste.
    id: "edit.paste-plain",
    section: "Banda",
    title: "Paste as plain text",
    unlisted: true,
    runsAsPerson: true,
    run: () => device.edit.pastePlain(),
  },
  {
    // A Thread menu's "Copy image": the image at a point of the page.
    id: "edit.copy-image",
    args: takes(
      {
        x: { number: "where the image is, across the page" },
        y: { number: "where the image is, down the page" },
      },
      ["x", "y"]
    ),
    section: "Banda",
    title: "Copy image",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.x === "number" && typeof args.y === "number")
        device.edit.copyImageAt(args.x, args.y)
    },
  },
  {
    id: "project.add",
    section: "Banda",
    title: "Add Project",
    // The menu lists "Add Project" as its own branch; this opens it
    // there: on the machine that has `project`, where a door knows its
    // own, as a new Thread's Project list (ADR 0120, decision 1).
    unlisted: true,
    args: takes({ project: "a Project of the machine it adds on" }),
    run: (shell, args) => {
      const host =
        typeof args?.project === "string"
          ? shell.hosts.hostOf(args.project as ProjectId)
          : null
      shell.route(host === null ? "project.add" : `project.add@${host ?? ""}`)
    },
  },
  // A Project's verbs, as its line in the sidebar list and its menu run
  // them (ADR 0026, decisions 5 and 6).
  {
    id: "projects.pin",
    args: takes(
      {
        project: "the Project",
        pinned: { flag: "true pins it, false unpins it" },
      },
      ["project", "pinned"]
    ),
    section: "Banda",
    title: "Pin a Project, so it comes first, or unpin it",
    unlisted: true,
    run: (shell, args) => {
      const { project, pinned } = args ?? {}
      if (typeof project !== "string" || typeof pinned !== "boolean") return
      updateProject(shell.engine, {
        project: project as ProjectId,
        pinned,
      }).catch((error: unknown) =>
        console.error("banda: the Project was not pinned", error)
      )
    },
  },
  {
    // The Person's Locate: it asks for the folder in the menu, which then
    // sends the engine's own `projects.locate` with the folder picked.
    id: "projects.locate",
    args: takes({ project: "the Project whose folder is missing" }, [
      "project",
    ]),
    section: "Banda",
    title: "Open the Banda menu to find a missing Project's folder",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.project === "string")
        shell.route(locateRoute(args.project as ProjectId))
    },
  },
  {
    id: "projects.settings",
    args: takes({ project: "the Project" }, ["project"]),
    section: "Banda",
    title: "Open the settings at a Project's own",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.project === "string")
        shell.settings(`projects/${args.project}`)
    },
  },
  {
    // The Person's Trust (#947), as the sidebar's Project card runs it:
    // trusting asks first, on the card by that card (ADR 0083, decision
    // 5), or where it is not drawn, in the Project's settings; taking it
    // back is at once, and puts the card off on this device, with a toast
    // where the engine refuses. The engine's own `projects.trust` only
    // the Person's gesture sends.
    id: "projects.trust",
    args: takes(
      {
        project: "the Project",
        trusted: { flag: "true asks whether to trust it, false stops" },
      },
      ["project", "trusted"]
    ),
    section: "Banda",
    title: "Ask whether to trust a Project, or stop trusting it",
    unlisted: true,
    run: (shell, args) => {
      const { project, trusted } = args ?? {}
      if (typeof project !== "string" || typeof trusted !== "boolean") return
      const id = project as ProjectId
      if (trusted) {
        if (!askTrust(id)) shell.settings(`projects/${id}`)
        return
      }
      notNow(id)
      trustProject(shell.engine, id, false).catch((error: unknown) =>
        toast.error(problem(error))
      )
    },
  },
  {
    // The Person's Remove from Banda: it asks first, as the Project's
    // settings do, then sends the engine's own `projects.remove`.
    id: "projects.remove",
    args: takes({ project: "the Project" }, ["project"]),
    section: "Banda",
    title: "Ask whether to remove a Project from Banda",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.project !== "string") return
      const project = shell.projectOf(args.project as ProjectId)
      if (project && !askRemoval(project))
        shell.settings(`projects/${project.id}`)
    },
  },
  {
    id: "settings.open",
    args: takes({ link: "a section, or a row in it, as keys" }),
    section: "Banda",
    title: "Open the settings",
    keys: [{ code: "Comma", mod: true }],
    // A Problem's toast opens it there: its `link` (ADR 0039). From a
    // Pane of another machine's, it shows that machine's parts (ADR 0106,
    // step 5b).
    run: (shell, args) =>
      shell.settings(
        typeof args?.link === "string" ? args.link : undefined,
        shell.here.get().pane?.host
      ),
  },
  {
    // Another machine's label, its ⋯ (ADR 0095, decision 6).
    id: "hosts.stop",
    args: takes({ name: "the machine's key in hosts.toml" }, ["name"]),
    // It stops Banda there, and with it its Agents: the Person's alone,
    // as `banda stop` is.
    runsAsPerson: true,
    section: "Banda",
    title: "Stop Banda on another machine",
    unlisted: true,
    run: (_, args) => {
      if (typeof args?.name === "string") stopHost(args.name)
    },
  },
  {
    id: "problems.look-into",
    args: takes({ fingerprint: "the Problem's fingerprint" }, ["fingerprint"]),
    // It starts a Thread with what to ask its Agent.
    runsAsPerson: true,
    section: "Banda",
    title: "Look into a Problem",
    unlisted: true,
    run: (shell, args) => {
      if (typeof args?.fingerprint === "string")
        shell.lookInto(args.fingerprint)
    },
  },
  {
    id: "update.check",
    section: "Banda",
    title: "Check for updates",
    run: () => device.update.check(),
  },
  {
    id: "update.restart",
    section: "Banda",
    title: "Restart Banda to install its update",
    // The bar's update runs it; with no version ready it does nothing
    // (ADR 0041, decision 2).
    unlisted: true,
    run: () => device.update.restart(),
  },
  {
    id: "banda.quit",
    section: "Banda",
    title: "Quit Banda",
    // It stops the engine and its Agents; closing the window does not
    // (ADR 0086, decision 3). Where a program reads the keys, as in a
    // terminal, the key is the program's: Emacs' quoted insert.
    keys: [{ code: "KeyQ", primary: true }],
    when: () => !document.activeElement?.closest(IN_PROGRAM),
    run: (shell) => shell.quit(),
  },
  {
    id: "keys.reset",
    section: "Banda",
    title: "Banda's own keys, until keys.toml changes",
    // No file binds it, so keys bound away can always be mended.
    keys: [RESET_KEY],
    overDialogs: true,
    run: (shell) => shell.ownKeys(),
  },
  {
    id: "sidebar.toggle",
    section: "Threads",
    title: "Show or hide the sidebar",
    keys: [{ code: "KeyA", mod: true }],
    run: (shell) => shell.toggleSidebar(),
  },
  {
    // Quiet (ADR 0098, decision 21): on until turned off, or off at once,
    // however long it was on for. The foot's bell turns it on for a while.
    id: "quiet.toggle",
    section: "Threads",
    title: "Turn Quiet on or off",
    keys: [{ code: "KeyQ", mod: true }],
    run: () => quiet.turn(quiet.on() ? "off" : "on"),
  },
  {
    id: "sidebar.show",
    args: takes({
      tab: "the tab it shows, with the focus in its list: inbox, working, later or archive",
    }),
    section: "Threads",
    title: "Show the sidebar",
    // The notice of many calls shows it, which lists them all; the small
    // inbox's "7 at work ›", on Working (ADR 0098, decision 22).
    unlisted: true,
    run: (shell, args) => {
      if (isTab(args?.tab)) askTab(args.tab)
      shell.showSidebar()
    },
  },
  // The sidebar's own keys, while the focus is in it (ADR 0098, decision
  // 13): the Sidebar runs them on its pick.
  ...SIDEBAR_KEYS.map(({ id, title, keys }) =>
    scoped(SIDEBAR, { id, title, section: "Sidebar", keys })
  ),
  // The launcher's letters (ADR 0025, decision 4).
  ...windowModule.actions,
]

/** Where the modules' item actions stand among the Window's own: after
 * its own Thread actions, as the key sheet listed them while they were
 * the Window's. It goes with B4h, actions by owner. */
const ITEMS_AT =
  WINDOW_ACTIONS.findIndex((action) => action.id === "sidebar.archive") + 1

/** Where the Tiling's last actions start, a Pane's to a workspace by its
 * number: the key sheet lists a section's rows in this list's order, and
 * has had them after the Window's own of the Panes, the Pane in a window
 * of its own. It goes once the key sheet keeps an order of its own
 * (#1731). */
const SENDS_AT = TILING_ACTIONS.findIndex(
  (action) => action.id === "pane.send-1"
)

/** Every action: the modules' (`modules.ts`), then the Tiling's and the
 * Window's own, with the modules' item actions among them (ADR 0087,
 * decisions 12 and 13). */
export const ACTIONS: readonly Action<Shell>[] = [
  ...modules.flatMap((module) => module.actions),
  ...TILING_ACTIONS.slice(0, SENDS_AT),
  ...WINDOW_ACTIONS.slice(0, ITEMS_AT),
  ...modules.flatMap((module) => module.items),
  ...WINDOW_ACTIONS.slice(ITEMS_AT),
  ...TILING_ACTIONS.slice(SENDS_AT),
]

/**
 * The window's own acts on a file, by the word their ids start with, as
 * Show in folder and Quick Look: a file is a value of a Project, the one
 * the Person is in where its args name none (ADR 0106, law 3). The ones
 * `ON_ITS_MACHINE` lists reach it through that machine's engine; the rest,
 * as Open in its app, are this device's disk, which another machine's
 * Project never has.
 */
const ON_FILES = "file"

/** The acts on a file that go to the machine of its Project: listed, so a
 * new one reaches no other machine's file until it is said to. */
const ON_ITS_MACHINE: ReadonlySet<string> = new Set([
  "file.open",
  "file.peek",
  "file.attach",
  "file.save-copy",
])

/**
 * The window's own acts on a web address: a value of the Pane's Project,
 * so the router weighs it there, and it runs in this window, on this
 * device's browser, on any machine's Project, but for an address of that
 * machine's own (`linkRefused`, ADR 0106, decision 3).
 */
const ON_LINKS = "link"

/**
 * The window's own acts on this machine's engine, by the word their ids
 * start with: its Projects', as Pin, and its Problems'. Add Project is
 * the window's: it opens the menu, which adds on the machine it names
 * (ADR 0120, decision 1).
 * One that names another machine's Project does not go there; one that
 * names none is this machine's, wherever the Person is. The rest of the
 * window's own are the window's, as the arrangement, the menu and the
 * settings.
 */
const ON_THIS_MACHINE: ReadonlySet<string> = new Set([
  "project",
  "projects",
  "problems",
])

/** `action` as the router weighs it (ADR 0106, law 3): a module's by its
 * App (`moduleAct`), the window's own by what it reaches. */
export function actOf(action: Action<Shell>): Act {
  const { title, id } = action
  const of = moduleAct(id)
  if (of) return { title, ...of }
  const owner = id.split(".", 1)[0]!
  if (owner === ON_LINKS)
    return {
      title,
      at: "owner",
      here: true,
      refuses: (args, machine) =>
        typeof args?.url === "string"
          ? linkRefused(args.url, machine)
          : undefined,
    }
  if (owner === ON_FILES)
    return ON_ITS_MACHINE.has(id)
      ? { title, at: "owner", app: "files", here: true }
      : { title, at: "device", here: true }
  const here = ON_THIS_MACHINE.has(owner) && id !== "project.add"
  return { title, at: here ? "device" : "window" }
}

/** What the window tells its Panes' hosts (`Routing`): each of its
 * actions as the router weighs it, and what this device can do. */
export const ROUTING: Routing = {
  act: (id) => {
    const action = ACTIONS.find((one) => one.id === id)
    return (
      action && {
        ...actOf(action),
        takes: (name) =>
          action.args !== undefined && name in action.args.properties,
      }
    )
  },
  has: device.has,
}

/** Where the Person is, as an act asked by a key or a menu is from: the
 * Pane in focus, on the host its frame names; else Here's Project. */
export function fromHere(shell: Pick<Shell, "here">): {
  here: { project: ProjectId; pane?: Pick<PaneState, "args"> }
} {
  const { pane, project } = shell.here.get()
  if (!pane) return { here: { project } }
  const { host } = pane
  return {
    here: { project: pane.project, pane: { args: host ? { host } : {} } },
  }
}

/**
 * Runs `action`, by its id or as found, as its key would, with `args`,
 * where the one router says (ADR 0106, law 3): keys, menus and Widgets go
 * through here, and a Pane's acts after its own route (`handlesOf`), so
 * an action does the same from each. One that does not run says why, as
 * "Not on arc yet: Open in a browser", never nothing; how it went is for
 * what asked from outside the window (asked.ts).
 */
export function runAction(
  shell: Shell,
  action: string | Action<Shell>,
  args?: Args
): Promise<Route> {
  const known =
    typeof action === "string"
      ? ACTIONS.find((one) => one.id === action)
      : action
  if (!known) throw new Error(`Banda has no action ${String(action)}`)
  return actAs(
    shell.hosts,
    () => routeAct(shell.hosts, actOf(known), fromHere(shell), args),
    (routed) => known.run(shell, routed)
  )
}
