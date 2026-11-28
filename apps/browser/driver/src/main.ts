/**
 * The driver as the engine starts it (ADR 0132, decision 3):
 *
 *   node browser-driver.mjs --chromium <chrome-headless-shell> [--first-tab <n>]
 *
 * Requests come on its input and answers go to its output, a line each
 * (lines.ts); what it has to say besides goes to its errors. It ends
 * when its input closes. Chromium always runs in its sandbox, and nothing
 * given here, as an argument or in the environment, starts it without.
 */
import { parseArgs } from "node:util"
import { browsers } from "./browsers"
import { serve } from "./lines"

const usage = () => {
  console.error(
    "browser-driver --chromium <chrome-headless-shell> [--first-tab <n>]"
  )
  process.exit(2)
}

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        chromium: { type: "string" },
        "first-tab": { type: "string", default: "1" },
      },
    })
  } catch {
    return usage()
  }
})()
const firstTab = Number(values["first-tab"])
if (!values.chromium || !Number.isSafeInteger(firstTab) || firstTab < 1) usage()

await serve(
  process.stdin,
  process.stdout,
  browsers({ chromium: values.chromium!, firstTab })
)
// Its last answers are written before it goes.
process.stdout.write("", () => process.exit(0))
