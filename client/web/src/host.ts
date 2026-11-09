/**
 * The bridge's table moved to `@banda/desktop/bridge`, and the words its
 * channels carry to `@banda/core` (ADR 0089, W0a1). This path stays, only
 * re-exporting what it exported but the table itself, so what imports it,
 * open PRs among them, keeps building; W0a2 points them all there and
 * removes it (`architecture.test.ts`). Of the desktop it takes only types,
 * so none of main's code comes into the page.
 */
export {
  type HostEntry,
  type HostState,
  type HostTest,
  type Note,
  type PoppedAsk,
  type Update,
  follow,
  poppedOf,
  poppedRoute,
} from "@banda/core"
export type { Host, Notice } from "@banda/desktop/bridge"
