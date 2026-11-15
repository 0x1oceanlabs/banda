import type { Engine, ProjectId } from "@banda/contract"
import { expect, test } from "vitest"
import {
  carry,
  Changed,
  droppedFile,
  Folder,
  machineFile,
  PIECE,
  type Source,
  Stopped,
} from "./across"

const PROJECT = "p" as ProjectId

/** A copy nobody stops. */
const never = new AbortController().signal

/** An engine that keeps the pieces it is given, as `files.take_piece`. */
function taking() {
  const kept: { job: string; at: number; bytes: number }[] = []
  const engine = {
    commandAt: (
      method: string,
      { job, at, data }: { job: string; at: number; data: string },
      _project: ProjectId,
      _command: string,
      options: { once?: boolean }
    ) => {
      expect(method).toBe("files.take_piece")
      expect(options.once).toBe(true)
      kept.push({ job, at, bytes: atob(data).length })
      return Promise.resolve({ answer: null })
    },
  } as unknown as Engine
  return { to: { engine, project: PROJECT }, kept }
}

const bytes = (size: number) => new Uint8Array(size).map((_, n) => n % 251)
const file = (size: number, name = "notes.md") =>
  droppedFile(new File([bytes(size)], name, { lastModified: 7 }))

test("a file goes in pieces of 512 KiB at most, each at its byte, and says how far", async () => {
  const { to, kept } = taking()
  const source = file(PIECE * 2 + 5)
  const heard: number[] = []
  await carry(
    to,
    source,
    await source.look(),
    "job",
    (n) => heard.push(n),
    never
  )
  expect(kept).toEqual([
    { job: "job", at: 0, bytes: PIECE },
    { job: "job", at: PIECE, bytes: PIECE },
    { job: "job", at: PIECE * 2, bytes: 5 },
  ])
  expect(heard).toEqual([PIECE, PIECE, 5])
  // A file of no bytes has no piece.
  const empty = file(0)
  await carry(to, empty, await empty.look(), "none", () => {}, never)
  expect(kept).toHaveLength(3)
})

test("a file that changed while it was read is not said to have come whole", async () => {
  const { to } = taking()
  const source = file(10)
  let looks = 0
  const moved: Source = {
    ...source,
    look: async () => ({
      size: 10,
      stamp: `10 ${looks++ === 0 ? "before" : "after"}`,
    }),
  }
  await expect(
    carry(to, moved, await moved.look(), "job", () => {}, never)
  ).rejects.toBeInstanceOf(Changed)
})

test("a copy stopped sends no more pieces", async () => {
  const { to, kept } = taking()
  const source = file(PIECE * 3)
  // Stopped as the first piece went.
  const stop = new AbortController()
  await expect(
    carry(
      to,
      source,
      await source.look(),
      "job",
      () => stop.abort(),
      stop.signal
    )
  ).rejects.toBeInstanceOf(Stopped)
  expect(kept).toHaveLength(1)
})

test("a machine's file is looked at by files.stat: a folder does not go, nor one that is gone", async () => {
  const stats: Record<string, object | null> = {
    "/p/a.txt": { path: "/p/a.txt", kind: "file", size: 3, modified: 9 },
    "/p/src": { path: "/p/src", kind: "folder" },
    "/p/gone": null,
  }
  const engine = {
    call: (method: string, { paths }: { paths: string[] }) => {
      expect(method).toBe("files.stat")
      return Promise.resolve(paths.map((path) => stats[path]))
    },
  } as unknown as Engine
  const of = (path: string) =>
    machineFile({ engine, project: PROJECT }, path, async () => null)
  expect(of("/p/a.txt").name).toBe("a.txt")
  await expect(of("/p/a.txt").look()).resolves.toEqual({
    size: 3,
    stamp: "3 9",
  })
  await expect(of("/p/src").look()).rejects.toBeInstanceOf(Folder)
  await expect(of("/p/gone").look()).rejects.toThrow("gone is not there.")
  // A file the machine gives no URL for is not read.
  await expect(of("/p/a.txt").read(0, never)).rejects.toThrow(
    "a.txt may not be read."
  )
})
