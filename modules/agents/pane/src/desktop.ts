/** The agents module's channels into the window (ADR 0037). */
import { type HostOf, invoke } from "@banda/contract/bridge"

export const AGENTS_BRIDGE = {
  /** A local media path, relative to its Space or absolute, as a signed
   * URL valid for one hour; null if it cannot be shown. */
  media: invoke<[space: string, path: string], string | null>(),
}
export type AgentsHost = HostOf<typeof AGENTS_BRIDGE>
