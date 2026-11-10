import { expect, test } from "vitest"
import { loginOutput } from "./login-output"

test("Claude's OSC link and colours leave one usable verification URL", () => {
  const link = "https://claude.com/cai/oauth/authorize?code=true&state=test"
  const output = `\u001b[32mVisit: \u001b]8;;${link}\u0007${link}\u001b]8;;\u0007\u001b[0m\nPaste code here >`
  expect(loginOutput(output)).toEqual({
    text: `Visit: ${link}\nPaste code here >`,
    links: [link],
  })
  expect(
    loginOutput(`\u001b]8;;${link}\u001b\\${link}\u001b]8;;\u001b\\`).links
  ).toEqual([link])
})
