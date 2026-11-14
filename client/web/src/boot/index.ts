/**
 * The device, as the page reaches it (ADR 0089, decisions 2 and 4): the
 * one import for its callers. On the desktop its adapter is
 * `desktop.ts`, over what the preload gives on `window.banda`. A browser
 * has none: there each part does nothing, but this machine's engine,
 * which is the door that served the page (`browser.ts`; ADR 0124, SE5).
 */
export { device, ELSEWHERE } from "./desktop"
