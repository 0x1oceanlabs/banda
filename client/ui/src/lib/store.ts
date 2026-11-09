/**
 * The store read by selector moved to `@banda/core` (ADR 0089, W0a1). This
 * path stays, only re-exporting it, so what imports it, open PRs among
 * them, keeps building; W0a2 points them all there and removes it
 * (`client/web/src/architecture.test.ts`).
 */
export { type Readable, sameData, sameEach, Store } from "@banda/core"
export { useSelected, useStore } from "@banda/core/react"
