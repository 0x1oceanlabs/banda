/** What Banda's hands refused in a page (`Refusal`, of
 * `@banda/browser-driver`, which knows no Effect), as main says it. The
 * one place the two meet. */
import { Refusal } from "@banda/browser-driver"
import { Refused } from "@banda/desktop-kit"

export const asRefused = ({ code, message }: Refusal) =>
  new Refused(code ? { code, message } : { message })
