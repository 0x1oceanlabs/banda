/**
 * What main's effects fail with (ADR 0020): a tagged class each, with the
 * message the page or stderr shows.
 */
import type { Code } from "@banda/contract"
import { Data } from "effect"

/** A channel was used by something other than Banda's page. */
export class NotFromPage extends Data.TaggedError("NotFromPage")<{
  readonly message: string
}> {}

/** What was asked is not so: a preset or an extension there is not, a
 * file not known yet, a value `banda settings` refused. `code` is how the
 * engine hears it, when a module answers its engine part (`Asked`); a
 * conflict unless it says. */
export class Refused extends Data.TaggedError("Refused")<{
  readonly message: string
  readonly code?: Code
}> {}

/** A program main ran broke, rather than refused. */
export class Broke extends Data.TaggedError("Broke")<{
  readonly message: string
}> {}
