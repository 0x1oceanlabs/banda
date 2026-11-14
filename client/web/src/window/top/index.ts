/**
 * The Window's Top layer (ADR 0087, decision 2): what lies over the
 * Panes. One order of its layers (`layers.ts`), one stack that says which
 * part is on top, what Esc takes away and where the keys go back
 * (`stack.ts`, ADR 0110, step 3), and the part an App asks for
 * (`part.tsx`, ADR 0116).
 */
export { closeTop, Layered, useTop, useTopFollows } from "./use-top"
export { type TopAsked, TopPart, useTops } from "./part"
