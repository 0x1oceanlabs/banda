/** The agents module's channels into the window (ADR 0037). */
import { type HostOf, invoke } from "@banda/contract/bridge"
import type { FoundFile } from "@banda/contract/agents"
import { hostOf } from "@banda/ui/desktop"

export const AGENTS_BRIDGE = {
  /** A local media path, relative to its Project or absolute, as a token
   * this machine's engine serves for an hour (`bytes.issue`, `media`),
   * which `bytesUrl` names; null if it cannot be shown. Images, video and
   * sound alone: a reply's paths are an Agent's to write. */
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
export const agentsHost = () => hostOf<typeof AGENTS_BRIDGE>("agents")
