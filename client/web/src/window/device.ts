/**
 * The Window's device part moved to `boot/` (ADR 0089, W0a1). This path
 * stays, only re-exporting it, so what imports it, open PRs among them,
 * keeps building; W0a2 points them all to `../boot` and removes it
 * (`architecture.test.ts`).
 */
export { device, ELSEWHERE } from "../boot"
