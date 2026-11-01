import { expect, test } from "vitest"
import { commandLine, signInFailed } from "./sign-in"

test("a sign-in command reads as a line to paste into a shell", () => {
  expect(
    commandLine({
      program: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.99.1", "--cli"],
      env: { CLAUDE_CONFIG_DIR: "/home/a/Work Claude" },
    })
  ).toBe(
    "CLAUDE_CONFIG_DIR='/home/a/Work Claude' npx -y @agentclientprotocol/claude-agent-acp@0.99.1 --cli"
  )
  expect(commandLine({ program: "x", args: ["it's", "a=b"], env: {} })).toBe(
    `x 'it'\\''s' 'a=b'`
  )
})

test("a sign-in in a terminal worked when its program ended with code 0", () => {
  expect(signInFailed({ code: 0 })).toBeNull()
  expect(signInFailed({ code: 1 })).toBe(
    "The sign-in ended with code 1. Try again."
  )
  expect(signInFailed({ signal: 15 })).toBe(
    "The sign-in was stopped before it ended. Try again."
  )
})
