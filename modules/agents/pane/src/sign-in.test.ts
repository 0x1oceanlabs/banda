import { expect, test } from "vitest"
import { commandLine } from "./sign-in"

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
