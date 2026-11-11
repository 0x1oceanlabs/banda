import { expect, test } from "vitest"
import { markdownOf } from "./copy"

const say = (kind: "person" | "agent", id: string, text: string) =>
  ({ author: { kind, id }, body: { kind: "message", text } }) as never

test("a Thread as Markdown: its title, then each message under who said it, its own Agent by its Harness's name", () => {
  const items = [
    say("person", "p", "Fix the list"),
    {
      author: { kind: "agent", id: "a1" },
      body: { kind: "thought", text: "hm" },
    },
    say("agent", "a1", "Reading it."),
    {
      author: { kind: "agent", id: "a1" },
      body: { kind: "tool", title: "Read" },
    },
    say("agent", "a1", "Done: **fixed**.\n"),
    say("agent", "a2", "From the reviewer."),
    say("person", "p", "  "),
    say("person", "p", "Thanks"),
  ] as never
  expect(
    markdownOf({ items }, "Fix the list", { agent: "a1", by: "Claude Code" })
  ).toBe(
    [
      "# Fix the list",
      "## You",
      "Fix the list",
      "## Claude Code",
      "Reading it.",
      "Done: **fixed**.",
      "## Another Agent",
      "From the reviewer.",
      "## You",
      "Thanks",
    ].join("\n\n") + "\n"
  )
  // A Harness with no name: its Agent.
  expect(
    markdownOf({ items: [say("agent", "a1", "hi")] }, "t", { agent: "a1" })
  ).toBe("# t\n\n## Agent\n\nhi\n")
})
