import { expect, test } from "vitest"
import { commandLine, wordsOf } from "./sign-in"

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

test("a line splits into the words the shell would read", () => {
  expect(wordsOf("  npx -y @a/b@1  ")).toEqual(["npx", "-y", "@a/b@1"])
  expect(wordsOf(`x 'it'\\''s' "a \\"b\\"" c\\ d ''`)).toEqual([
    "x",
    "it's",
    'a "b"',
    "c d",
    "",
  ])
  const line = commandLine({ program: "x", args: ["it's", "a b"], env: {} })
  expect(wordsOf(line)).toEqual(["x", "it's", "a b"])
})
