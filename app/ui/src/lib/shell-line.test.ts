import { expect, it } from "vitest"
import { shellLine } from "./shell-line"

it("is one line of a shell, without its prompt", () => {
  expect(shellLine("bash", "pnpm install\n")).toBe("pnpm install")
  expect(shellLine("console", "$ git status")).toBe("git status")
  expect(shellLine("ZSH", "  ls -la  ")).toBe("ls -la")
  expect(shellLine("shellsession", "$ pwd")).toBe("pwd")
})

it("is none for more lines, another language, or no words", () => {
  expect(shellLine("bash", "cd app\npnpm test")).toBeNull()
  expect(shellLine("ts", "const a = 1")).toBeNull()
  expect(shellLine("", "ls")).toBeNull()
  expect(shellLine("sh", "$ ")).toBeNull()
})
