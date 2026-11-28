/**
 * What Banda's hands refuse, in words for the Agent. The driver answers
 * it as it is; the window's main process turns it into its own `Refused`
 * in one place (`apps/browser/desktop/src/refused.ts`).
 */
import type { Code } from "@banda/contract"

/** What was asked is not so. `code` is how the engine hears it: a
 * conflict unless it says. */
export class Refusal extends Error {
  readonly code?: Code
  constructor({ message, code }: { message: string; code?: Code }) {
    super(message)
    this.name = "Refusal"
    this.code = code
  }
}

/** What went wrong, in its own words. */
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/** A tab no call may name: one there is not, or one outside its reach. */
export const noTab = (tab: number) =>
  new Refusal({
    code: "not_found",
    message: `There is no tab ${tab}: browser_tabs lists them.`,
  })
