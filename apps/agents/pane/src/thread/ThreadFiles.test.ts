import type { ProjectId } from "@banda/contract"
import type { Item } from "@banda/contract/agents"
import type { Located } from "@banda/contract/files"
import { type Device, deviceFile, projectFile } from "@banda/core/react"
import { beforeEach, expect, test, vi } from "vitest"
import { ThreadFiles, type FilesHands } from "./ThreadFiles"

const edited = vi.hoisted(() => [] as unknown[])
vi.mock("@banda/ui/lib/outside", () => ({
  openInEditor: (file: unknown, at: unknown) => {
    edited.push([file, at])
  },
}))

beforeEach(() => {
  edited.length = 0
})

const ARC = "arc-project" as ProjectId

const at = (file: string): Located & { line: number } => ({
  asked: file,
  file,
  relative: file,
  inside: true,
  line: 12,
})

/** A Thread's files through a fake engine, with what its Pane holds: a
 * device for which every file is this computer's, or none is. */
function filesOn(local: boolean, answer: Located[] = []) {
  const calls: unknown[][] = []
  const call = (...asked: unknown[]) => {
    calls.push(asked)
    return Promise.resolve(answer)
  }
  const files = new ThreadFiles({ call } as never, ARC)
  const ran: [string, unknown][] = []
  const device: Device = {
    has: () => true,
    local: (file) => (local ? deviceFile(file.path) : undefined),
    across: () => undefined,
  }
  const hands: FilesHands = {
    run: (action, args) => ran.push([action, args]),
    device,
    file: (path) => projectFile(ARC, path),
  }
  return { files, calls, ran, hands }
}

const tool = (title: string): Item =>
  ({ body: { kind: "tool", title, content: [] } }) as unknown as Item

test("the paths are asked of the Project's machine, with where its tools worked", async () => {
  const found = [at("/arc/w/src/a.ts")]
  const { files, calls, hands } = filesOn(false, found)
  files.follow([tool("Read /arc/w/src/a.ts")], hands)
  expect(await files.find(["src/a.ts"])).toBe(found)
  expect(calls).toEqual([
    [
      "files.locate",
      { paths: ["src/a.ts"], worked: ["/arc/w/src/a.ts"] },
      { project: ARC },
    ],
  ])
})

test("a click opens the file at its line through the router", () => {
  const { files, ran, hands } = filesOn(false)
  files.follow([], hands)
  files.open(at("/arc/w/a.ts"), false)
  expect(ran).toEqual([
    ["file.open", { file: "/arc/w/a.ts", project: ARC, line: 12 }],
  ])
})

test("another machine's file opens in no editor here: Ctrl opens it in Files too, and the device's acts are not offered", () => {
  const { files, ran, hands } = filesOn(false)
  files.follow([], hands)
  files.open(at("/arc/w/a.ts"), true)
  files.edit(at("/arc/w/a.ts"))
  expect(edited).toEqual([])
  expect(ran).toEqual([
    ["file.open", { file: "/arc/w/a.ts", project: ARC, line: 12 }],
  ])
  expect(files.onDevice(at("/arc/w/a.ts"))).toBe(false)
})

test("this computer's file opens in the editor with Ctrl, as a DeviceFile", () => {
  const { files, ran, hands } = filesOn(true)
  files.follow([], hands)
  files.open(at("/home/me/a.ts"), true)
  expect(ran).toEqual([])
  expect(edited).toEqual([[deviceFile("/home/me/a.ts"), at("/home/me/a.ts")]])
  expect(files.onDevice(at("/home/me/a.ts"))).toBe(true)
})

test("with no device, a path has no way out of Banda", () => {
  const { files, hands } = filesOn(true)
  files.follow([], { run: hands.run })
  expect(files.onDevice(at("/w/a.ts"))).toBe(false)
})
