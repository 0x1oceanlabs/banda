/**
 * What Banda's desktop needs of the browser (app/desktop/src/browser.ts):
 * the profile it keeps pages in, and which keys it takes from them.
 */
export { type Pressed, taken } from "./keys"

/** The profile every page shares (ADR 0013, decision 2). */
export const PARTITION = "persist:browser"
