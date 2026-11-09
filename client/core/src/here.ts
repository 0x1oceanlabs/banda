/**
 * Here (ADR 0087, decision 4): where the Person is in one Window, as a
 * program's working folder says where it runs. Only the Window writes it.
 * A widget reads the fields it needs by selector (`useHere`, in
 * `@banda/core/react`), so it is drawn again only as they change; an act
 * reads it as it runs, from its Window (`WindowApi.here`). A Pane never
 * reads it to draw: what it shows comes from its args, the same on every
 * client. No host keeps it.
 */
import type { ProjectId } from "@banda/contract"
import type { Readable } from "./store"

export type Here = {
  /** The Window is in front: it has the desktop's focus, so the Person
   * sees what it shows (ADR 0011, decision 1). */
  front: boolean
  /** The Sidebar shows. */
  sidebar: boolean
  /** The workspace on screen, with its Project where it is a Project's
   * (ADR 0065); none where no Tiling is. */
  workspace: { id: string; project?: ProjectId } | null
  /** The Pane in focus, its Project, the one thing it shows, by the id
   * its App lists it with (`PaneKind.shows`): a Thread's for a Thread,
   * and the other host of `hosts.toml` its Project is on, the one whose
   * engine its frame gives it (ADR 0081): an act that would go to this
   * machine's engine stays off there. None while no Pane has the focus. */
  pane: {
    id: string
    project: ProjectId
    subject?: string
    host?: string
  } | null
  /** The Project the Person is in: the Pane's, else the workspace's,
   * else the Window's home, where a new Thread starts. */
  project: ProjectId
}

/** Here as a Window keeps it: what it is now, the Tiling's last change
 * included, and who hears it change, told once the Window drew it. */
export type HereStore = Readable<Here>
