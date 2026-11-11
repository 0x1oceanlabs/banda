import { beforeEach, expect, test, vi } from "vitest"

const copied = vi.hoisted(() => ({ texts: [] as string[] }))
vi.mock("@banda/ui/lib/clipboard", () => ({
  copyText: (text: string) => void copied.texts.push(text),
}))

const { openToPaste } = await import("./Issue")

const PAGE = "https://github.com/0x1oceanlabs/banda/issues/new"

beforeEach(() => {
  copied.texts.length = 0
})

test("an issue gh did not file opens GitHub's page through the router, and copies nothing", () => {
  const openLink = vi.fn()
  openToPaste(PAGE, "What happened", undefined, openLink)
  expect(openLink.mock.calls).toEqual([[PAGE]])
  expect(copied.texts).toEqual([])
})

test("a comment, which its address does not fill in, waits on this device's clipboard", () => {
  const openLink = vi.fn()
  openToPaste(PAGE, "What happened", 77, openLink)
  expect(copied.texts).toEqual(["What happened"])
  expect(openLink.mock.calls).toEqual([[PAGE]])
})
