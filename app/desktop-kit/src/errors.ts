/**
 * What main's effects fail with (ADR 0020): a tagged class each, with the
 * message the page or stderr shows.
 */
import { Data } from "effect"

/** A channel was used by something other than Banda's page. */
export class NotFromPage extends Data.TaggedError("NotFromPage")<{
  readonly message: string
}> {}

/** What was asked is not so: a preset or an extension there is not, a
 * file not known yet, a value `banda settings` refused. */
export class Refused extends Data.TaggedError("Refused")<{
  readonly message: string
}> {}

/** A program main ran broke, rather than refused. */
export class Broke extends Data.TaggedError("Broke")<{
  readonly message: string
}> {}
