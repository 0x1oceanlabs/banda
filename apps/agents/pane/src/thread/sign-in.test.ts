import { expect, test } from "vitest"
import { commandLine, waysShown, wordsOf } from "./sign-in"

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

test("a Harness on another machine signs in by that machine's ways for another's window, and here nothing changes", () => {
  const way = (id: string, terminal: boolean, elsewhere = false) => ({
    id,
    elsewhere,
    ...(terminal && { terminal: {} }),
  })
  const ids = (ways: { id: string }[]) => ways.map((one) => one.id)
  const codex = [
    way("chat-gpt", false),
    way("page", true, true),
    way("device-code", true, true),
  ]
  // Here the Harness opens this computer's browser itself.
  expect(ids(waysShown(codex, false).ways)).toEqual(["chat-gpt"])
  // There its browser is one no one sees: its CLI's ways stand for it.
  const there = waysShown(codex, true)
  expect(ids(there.ways)).toEqual(["page", "device-code"])
  expect(there.unseen).toBe(false)
  // Claude Code's are in a terminal on both.
  const claude = [way("claude-ai-login", true), way("console-login", true)]
  expect(waysShown(claude, false).ways).toHaveLength(2)
  expect(waysShown(claude, true)).toEqual({ ways: claude, unseen: false })
  // A Harness with a way of its own alone says so there.
  expect(waysShown([way("browser", false)], true)).toEqual({
    ways: [],
    unseen: true,
  })
})
