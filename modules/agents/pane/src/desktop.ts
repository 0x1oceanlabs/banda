/** The agents module's channels into the window (ADR 0037). */
import { type HostOf, invoke } from "@banda/contract/bridge"
import type { FoundFile } from "@banda/contract/agents"

export const AGENTS_BRIDGE = {
  /** A local media path, relative to its Project or absolute, as a signed
   * URL valid for one hour; null if it cannot be shown. */
  media: invoke<[project: string, path: string], string | null>(),
  /** The file each path in a reply names, or none (ADR 0063, decision 2):
   * from the Project's folder, then from the folders `worked` names, the
   * full paths the Thread's tools named, latest first. */
  paths: invoke<
    [project: string, paths: readonly string[], worked: readonly string[]],
    Array<FoundFile | null>
  >(),
}
export type AgentsHost = HostOf<typeof AGENTS_BRIDGE>

/** The agents module's channels, where a window runs it; none in a test. */
export function agentsHost(): AgentsHost | undefined {
  return (window as unknown as { banda?: { agents: AgentsHost } }).banda?.agents
}
