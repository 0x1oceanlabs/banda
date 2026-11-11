import { beforeEach, expect, test, vi } from "vitest"

const copied = vi.hoisted(() => ({
  texts: [] as string[],
  done: Promise.resolve(),
}))
vi.mock("@banda/ui/lib/clipboard", () => ({
  copyText: (text: string) => {
    copied.texts.push(text)
    return copied.done
  },
}))

const { openToPaste } = await import("./Issue")

const PAGE = "https://github.com/0x1oceanlabs/banda/issues/new"

beforeEach(() => {
  copied.texts.length = 0
  copied.done = Promise.resolve()
})

test("an issue gh did not file opens GitHub's page through the router, and copies nothing", async () => {
  const openLink = vi.fn()
  await openToPaste(PAGE, "What happened", undefined, openLink)
  expect(openLink.mock.calls).toEqual([[PAGE]])
  expect(copied.texts).toEqual([])
})

test("a comment, which its address does not fill in, waits on this device's clipboard", async () => {
  const openLink = vi.fn()
  await openToPaste(PAGE, "What happened", 77, openLink)
  expect(copied.texts).toEqual(["What happened"])
  expect(openLink.mock.calls).toEqual([[PAGE]])
})

test("the page opens only once the comment is on the clipboard, as the browser takes the focus the copy needs", async () => {
  let copy = () => {}
  copied.done = new Promise<void>((resolve) => (copy = resolve))
  const openLink = vi.fn()
  const opening = openToPaste(PAGE, "What happened", 77, openLink)
  await Promise.resolve()
  expect(openLink).not.toHaveBeenCalled()
  copy()
  await opening
  expect(openLink.mock.calls).toEqual([[PAGE]])
})
