import { expect, test } from "vitest"
import {
  commentLabel,
  commentStart,
  commentText,
  isComment,
  withComments,
} from "./comments"

const comment = {
  id: "c1",
  path: "src/a.ts",
  lines: [12, 14] as const,
  comment: "Why twice?",
  text: "const one = 1\nconst two = 2\nconst one2 = 1",
}

test("a chip with lines or words is a comment; a bare path is a file to name", () => {
  expect(isComment({ path: "/w/a.ts" })).toBe(false)
  expect(isComment({ path: "/w/a.ts", lines: [1, 2] })).toBe(true)
  expect(isComment({ path: "/w/a.ts", comment: "hm" })).toBe(true)
})

test("a comment's chip names the file and its lines, and the start of the words", () => {
  expect(commentLabel(comment)).toBe("a.ts:12-14")
  expect(commentLabel({ path: "src/a.ts", lines: [3, 3] })).toBe("a.ts:3")
  expect(commentStart("Why twice?\nAnd here")).toBe("Why twice?")
  expect(commentStart("x".repeat(60), 10)).toBe(`${"x".repeat(9)}…`)
})

test("sent, a comment reads as where it is, its lines fenced in their language, then the words", () => {
  expect(commentText(comment)).toBe(
    [
      "Comment on src/a.ts:12-14:",
      "```ts",
      "const one = 1",
      "const two = 2",
      "const one2 = 1",
      "```",
      "Why twice?",
    ].join("\n")
  )
  // A fence outlasts the backticks in the lines; a file with no
  // extension is text.
  expect(
    commentText({ id: "c", path: "Makefile", lines: [1, 1], text: "a ``` b" })
  ).toBe(["Comment on Makefile:1:", "````text", "a ``` b", "````"].join("\n"))
})

test("a message carries its comments after its text, each apart", () => {
  expect(withComments("Look at these.", [])).toBe("Look at these.")
  const other = { id: "c2", path: "b.md", comment: "Shorter?" }
  expect(withComments("Look at these.\n", [comment, other])).toBe(
    ["Look at these.", commentText(comment), "Comment on b.md:\nShorter?"].join(
      "\n\n"
    )
  )
  // A message of comments alone.
  expect(withComments("", [other])).toBe("Comment on b.md:\nShorter?")
})
