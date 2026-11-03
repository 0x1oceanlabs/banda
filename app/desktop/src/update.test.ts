import { expect, it } from "vitest"
import { needsPerson, notesOf } from "./update"

const info = (releaseNotes: unknown) =>
  ({ version: "0.1.0-dev.66", releaseNotes }) as Parameters<typeof notesOf>[0]

it("lists what changed since the Person's version, as text", () => {
  expect(
    notesOf(
      info([
        {
          version: "0.1.0-dev.66",
          note: "<p>Built from 6c3d557: fix(ci): the runner&#39;s hook ends in .sh</p>",
        },
        { version: "0.1.0-dev.65", note: "<p>a &amp; b &lt;c&gt;</p>" },
        { version: "0.1.0-dev.64", note: null },
        { version: "0.1.0-dev.62", note: "<p>the Person's own</p>" },
      ]),
      "0.1.0-dev.62"
    )
  ).toEqual([
    {
      version: "0.1.0-dev.66",
      text: "Built from 6c3d557: fix(ci): the runner's hook ends in .sh",
    },
    { version: "0.1.0-dev.65", text: "a & b <c>" },
  ])
})

it("takes one release's notes when they come as one text", () => {
  expect(notesOf(info("<h2>What's Changed</h2>"), "0.1.0")).toEqual([
    { version: "0.1.0-dev.66", text: "What's Changed" },
  ])
  expect(notesOf(info(null), "0.1.0")).toEqual([])
})

it("shows only what the Person has to mend", () => {
  const coded = (code: string) => Object.assign(new Error(code), { code })
  expect(needsPerson(coded("EACCES"))).toBe(true)
  expect(needsPerson(coded("ENOSPC"))).toBe(true)
  expect(needsPerson(coded("ENOTFOUND"))).toBe(false)
  expect(needsPerson(new Error("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"))).toBe(
    false
  )
})
