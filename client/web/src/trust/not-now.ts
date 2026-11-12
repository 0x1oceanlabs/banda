/**
 * The Projects whose trust the Person put off on this device (ADR 0098,
 * decision 16): a Project not trusted is a card in Your turn until they
 * trust it, or say not now: on its card, as they add it ("Not yet") or as
 * they stop trusting it. The engine keeps no answer but trust itself, so
 * this device keeps the rest; a window whose storage keeps nothing asks
 * again as it starts.
 */
import { useMemo } from "react"
import type { ProjectId } from "@banda/contract"
import { kept } from "@banda/ui/lib/kept"

/** When the Person put each off, by its id. */
const putOff = kept(
  "banda.trust.not-now",
  (value: unknown): value is number => typeof value === "number"
)

/** The Person put off trusting `project`: its card goes, on this device. */
export function notNow(project: ProjectId, now = Date.now()): void {
  if (!(project in putOff.read())) putOff.put(project, now)
}

/** The Projects whose trust the Person put off, as they change. */
export function useNotNow(): ReadonlySet<ProjectId> {
  const record = putOff.use()
  return useMemo(() => new Set(Object.keys(record) as ProjectId[]), [record])
}
