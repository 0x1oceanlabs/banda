/**
 * Another machine's name and icon in the Tiling's Slot `pane.header`
 * (ADR 0095, decision 7): a Pane of a Project another host has names it
 * after its Project, as the Window's hosts know it. No App owns the
 * machines, so it is the Window's own part of the Slot.
 */
import type { ProjectId } from "@banda/contract"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { paneHost, type PaneState } from "@banda/ui/pane"
import type { Filler, HeaderProps } from "@banda/ui/slots"
import { useNamedOf } from "./hosts"

function Named({ project, pane }: { project: ProjectId; pane: PaneState }) {
  const named = useNamedOf(project, paneHost(pane))
  return named ? <MachineMark named={named} form="full" /> : null
}

/** Where the Person writes to another machine, it is named; in the
 * header alone. */
function MachineHeader({ at, project, pane }: HeaderProps) {
  return at === "project" ? <Named project={project} pane={pane} /> : null
}

export const machineHeader: Filler<"pane.header"> = {
  id: "window.machine",
  slot: "pane.header",
  Fill: MachineHeader,
}
