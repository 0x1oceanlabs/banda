import { expect, test } from "vitest"
import { askedOf, offersSaying, trustAbout } from "./trust"

test("a clone from another's GitHub says where it came from, and lists what its Harnesses would load", () => {
  expect(
    askedOf({
      foreign: true,
      why: [
        { kind: "cloned", from: "github.com/acme/widget" },
        { kind: "holds", name: ".claude" },
        { kind: "holds", name: ".mcp.json" },
      ],
    })
  ).toEqual({
    line: "Cloned from github.com/acme/widget · it has .claude/ and .mcp.json",
    from: true,
    waits: [
      {
        name: ".claude/",
        holds: "Claude Code's settings and hooks",
        kind: "folder",
      },
      { name: ".mcp.json", holds: "MCP servers", kind: "file" },
    ],
    cloned: true,
  })
})

test("a folder only holding what a Harness loads says what it has", () => {
  const asked = askedOf({
    foreign: true,
    why: [
      { kind: "holds", name: ".claude" },
      { kind: "holds", name: ".codex" },
      { kind: "holds", name: ".mcp.json" },
    ],
  })
  expect(asked.line).toBe("It has .claude/, .codex/ and .mcp.json")
  expect(asked.from).toBe(false)
  expect(asked.cloned).toBe(false)
  expect(asked.waits.map((one) => one.name)).toEqual([
    ".claude/",
    ".codex/",
    ".mcp.json",
  ])
})

test("another account's remote names its owner; a devcontainer is a reason but waits for no trust", () => {
  const asked = askedOf({
    foreign: true,
    why: [
      { kind: "remote", remote: "upstream", at: "github.com/acme/widget" },
      { kind: "holds", name: ".devcontainer" },
    ],
  })
  expect(asked.line).toBe(
    "Its remote upstream is github.com/acme/widget, whose owner is not you · it has .devcontainer/"
  )
  expect(asked.waits).toEqual([])
  expect(asked.cloned).toBe(false)
})

test("a folder that does not look foreign has nothing to say", () => {
  expect(askedOf({ foreign: false, why: [] })).toEqual({
    from: false,
    waits: [],
    cloned: false,
  })
})

test("where the fence holds, only a Project the Person said they trust gives its Agents their GitHub token", () => {
  const said = { trusted: true, trust_said: true }
  const unsaid = { trusted: true, trust_said: false }
  expect(trustAbout(said, true)).toMatch(
    /Its Agents also get your GitHub token\.$/
  )
  expect(trustAbout(unsaid, true)).toMatch(/once you say you trust it\.$/)
  expect(offersSaying(unsaid, true)).toBe(true)
  expect(offersSaying(said, true)).toBe(false)
  expect(trustAbout({ trusted: false }, true)).toMatch(/^Not trusted\./)
})

test("where the fence does not hold, trust says nothing of the GitHub token: the Agents act as the Person", () => {
  const unsaid = { trusted: true, trust_said: false }
  expect(trustAbout(unsaid, false)).toBe(
    trustAbout({ trusted: true, trust_said: true }, false)
  )
  expect(trustAbout(unsaid, false)).not.toMatch(/GitHub/)
  expect(offersSaying(unsaid, false)).toBe(false)
})
