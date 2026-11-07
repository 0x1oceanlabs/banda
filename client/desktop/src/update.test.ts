import { expect, it } from "vitest"
import { arrivedAt, firstLine, needsPerson, notesOf } from "./update"

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
        {
          version: "0.1.0-dev.65",
          note: "<p>Built from <code>3e145b7</code>: a &amp; b &lt;c&gt;</p><p>next</p>",
        },
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
    { version: "0.1.0-dev.65", text: "Built from 3e145b7: a & b <c> next" },
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

it("keeps an error's first line, without its headers", () => {
  expect(firstLine("HttpError: 404 \nHeaders: {…}")).toBe("HttpError: 404")
})

it("says Banda updated only when it restarted into the version left (ADR 0072)", () => {
  const notes = [{ version: "0.1.0-dev.104", text: "the hook" }]
  const left = JSON.stringify({
    from: "0.1.0-dev.97",
    to: "0.1.0-dev.104",
    notes,
  })
  expect(arrivedAt(left, "0.1.0-dev.104")).toEqual({
    from: "0.1.0-dev.97",
    notes,
  })
  // The install did not take, or an older file stayed behind.
  expect(arrivedAt(left, "0.1.0-dev.97")).toBeUndefined()
  expect(arrivedAt("{", "0.1.0-dev.104")).toBeUndefined()
})
