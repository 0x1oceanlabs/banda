/**
 * The bridge's table moved to `@banda/desktop/bridge`, and the words its
 * channels carry to `@banda/core` (ADR 0089, W0a1). This path stays, only
 * re-exporting their types, so what imports it, open PRs among them, keeps
 * building; W0a2 points them all there and removes it
 * (`architecture.test.ts`).
 */
export type {
  HostEntry,
  HostState,
  HostTest,
  Note,
  PoppedAsk,
  Update,
} from "@banda/core"
export type { Host } from "@banda/desktop/bridge"
