import { type Engine, type ProjectId, Refused } from "@banda/contract"
import type { ThreadId } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { carry, type Looked, look, Stopped, Unsent, type Way } from "./carry"

const THREAD = "t1" as ThreadId
const [HERE, THERE] = ["s1" as ProjectId, "s2" as ProjectId]

type Asked = [machine: string, method: string, params: Record<string, unknown>]

/**
 * Two machines' engines, which answer as engines do and keep what they
 * were asked, in order: `answers` by method, a value or what makes one of
 * the params; an `Error` there is thrown.
 */
function machines(
  answers: Record<string, unknown> = {},
  folders = { m1pro: {}, devbox: {} } as Record<string, object>
) {
  const asked: Asked[] = []
  // Two pieces of the Thread's artefact, and one of the folder's bundle.
  const parts: Record<string, string[]> = {
    thread: [btoa("abcd"), btoa("ef")],
    folder: [btoa("xyz")],
  }
  const answer = (machine: string, method: string, params: object) => {
    asked.push([machine, method, params as Record<string, unknown>])
    const given = answers[`${machine}:${method}`] ?? answers[method]
    if (given instanceof Error) return Promise.reject(given)
    if (given !== undefined)
      return Promise.resolve(
        typeof given === "function" ? given(params) : given
      )
    const { part = "thread", at = 0 } = params as { part?: string; at?: number }
    switch (method) {
      case "git.folder_for":
        return Promise.resolve({
          git: true,
          free: true,
          tips: ["c2", "c1"],
          has: machine === "devbox" ? ["c1"] : [],
          ...folders[machine],
        })
      case "git.status":
        return Promise.resolve({ branch: "feat/x", files: [{}, {}], ahead: 1 })
      case "agents.pack_thread":
        return Promise.resolve({
          move: "m",
          thread: THREAD,
          size: 6,
          sha256: "aa",
        })
      case "git.pack_folder":
        return Promise.resolve({
          branch: "feat/x",
          head: "c2",
          changed: 2,
          size: 3,
          sha256: "bb",
        })
      case "agents.packed": {
        const pieces = parts[part]
        const index = at === 0 ? 0 : 1
        return Promise.resolve({
          data: pieces[index],
          more: index < pieces.length - 1,
        })
      }
      default:
        return Promise.resolve(null)
    }
  }
  const engine = (machine: string) =>
    ({
      call: (method: string, params: object) => answer(machine, method, params),
      commandAt: (method: string, params: object) =>
        answer(machine, method, params).then((answer) => ({ answer, at: 1 })),
    }) as unknown as Engine
  const way: Way = {
    thread: THREAD,
    from: {
      engine: engine("m1pro"),
      project: HERE,
      machine: "m1pro",
      name: "banda",
    },
    to: {
      engine: engine("devbox"),
      project: THERE,
      machine: "devbox",
      name: "banda",
    },
  }
  const methods = () => asked.map(([machine, method]) => `${machine} ${method}`)
  return { way, asked, methods }
}

const goes: Looked = {
  kind: "goes",
  branch: "feat/x",
  changed: 2,
  ahead: 1,
  have: ["c1"],
}

test("both folders are asked, and the folder's work goes when they are one repository and the other is free", async () => {
  const { way, asked } = machines()
  expect(await look(way)).toEqual(goes)
  // The other folder is asked for the commits this one names.
  expect(asked[1]).toEqual([
    "devbox",
    "git.folder_for",
    { commits: ["c2", "c1"] },
  ])
})

test("the Thread moves alone where a folder is no repository, or the other has none of its commits", async () => {
  const stays = async (folders: Record<string, object>) => {
    const looked = await look(machines({}, folders).way)
    return looked.kind === "stays" ? looked.why : looked
  }
  expect(await stays({ m1pro: { git: false } })).toBe(
    "This folder is not a git repository, so the code stays on m1pro."
  )
  expect(await stays({ devbox: { git: false } })).toBe(
    "banda on devbox is not a git repository, so the code stays on m1pro."
  )
  expect(await stays({ devbox: { has: [] } })).toBe(
    "banda on devbox has none of this branch's commits, so the code stays on m1pro."
  )
  // An engine whose Git App is off has no such method.
  const off = new Refused({ code: "not_found", message: "No such method." })
  const looked = await look(machines({ "m1pro:git.folder_for": off }).way)
  expect(looked).toEqual({
    kind: "stays",
    why: "Git is off for this Project, so the code stays on m1pro.",
  })
})

test("a folder there with changes of its own refuses the move, and nothing is packed", async () => {
  const { way, methods } = machines({}, { devbox: { free: false } })
  const looked = await look(way)
  expect(looked).toEqual({
    kind: "refused",
    why: "banda on devbox has changes that are not committed: commit or stash them there, then move the Thread.",
  })
  await expect(carry(way, looked)).rejects.toThrow("not committed")
  expect(methods().some((asked) => asked.includes("pack"))).toBe(false)
})

test("the Thread and its folder's work are packed, carried in pieces and unpacked, the folder first, then it leaves", async () => {
  const { way, asked, methods } = machines()
  const progress: number[] = []
  await carry(way, goes, {
    message: " go on ",
    onProgress: ({ done, of, arriving }) =>
      progress.push(arriving ? -1 : done / of),
  })
  expect(methods()).toEqual([
    "m1pro agents.pack_thread",
    "m1pro git.pack_folder",
    "m1pro agents.packed",
    "devbox agents.take_piece",
    "m1pro agents.packed",
    "devbox agents.take_piece",
    "m1pro agents.packed",
    "devbox agents.take_piece",
    "devbox git.unpack_folder",
    "devbox agents.unpack_thread",
    "m1pro agents.leave_thread",
    "devbox agents.send",
  ])
  const params = (method: string) =>
    asked.filter(([, name]) => name === method).map(([, , params]) => params)
  expect(params("git.pack_folder")).toEqual([
    { move: "m", thread: THREAD, have: ["c1"] },
  ])
  // Each piece goes where the last one ended, the folder's by its part.
  expect(params("agents.take_piece")).toEqual([
    { move: "m", part: "folder", at: 0, data: btoa("xyz") },
    { move: "m", part: "thread", at: 0, data: btoa("abcd") },
    { move: "m", part: "thread", at: 4, data: btoa("ef") },
  ])
  expect(params("git.unpack_folder")).toEqual([
    { move: "m", thread: THREAD, branch: "feat/x", head: "c2", sha256: "bb" },
  ])
  // The other machine is told both machines' names, and that the folder
  // came; this one, where the Thread went.
  expect(params("agents.unpack_thread")).toEqual([
    { move: "m", sha256: "aa", from: "m1pro", on: "devbox", folder: true },
  ])
  expect(params("agents.leave_thread")).toEqual([
    { move: "m", project: THERE, machine: "devbox" },
  ])
  expect(params("agents.send")).toEqual([{ thread: THREAD, text: "go on" }])
  // Each piece, then the other machine unpacks.
  expect(progress).toEqual([0, 3 / 9, 7 / 9, 1, -1])
})

test("a Thread that moves alone carries no bundle, and says the folder did not come", async () => {
  const { way, asked, methods } = machines()
  await carry(way, { kind: "stays", why: "…" })
  expect(methods().filter((asked) => asked.includes("git."))).toEqual([])
  const unpack = asked.find(([, method]) => method === "agents.unpack_thread")
  expect(unpack?.[2]).toMatchObject({ folder: false })
  expect(methods().at(-1)).toBe("m1pro agents.leave_thread")
})

test("stopped before the other machine unpacks, nothing there changes", async () => {
  const stop = new AbortController()
  const { way, methods } = machines({
    // Stopped as the first piece is on its way.
    "devbox:agents.take_piece": () => (stop.abort(), null),
  })
  await expect(carry(way, goes, { stop: stop.signal })).rejects.toBeInstanceOf(
    Stopped
  )
  expect(methods().filter((asked) => asked.startsWith("devbox"))).toEqual([
    "devbox agents.take_piece",
  ])
  expect(methods()).not.toContain("m1pro agents.leave_thread")
})

test("a Thread that does not leave stays, and the other machine gives its copy back", async () => {
  const went = new Refused({
    code: "conflict",
    message: "The Thread changed as it moved, and stays here: move it again.",
  })
  const { way, methods } = machines({ "agents.leave_thread": went })
  await expect(carry(way, goes, { message: "go on" })).rejects.toBe(went)
  expect(methods().slice(-2)).toEqual([
    "m1pro agents.leave_thread",
    "devbox agents.give_back",
  ])
})

test("a Thread the other machine does not take says where its folder's work is, and never leaves", async () => {
  const none = new Refused({
    code: "conflict",
    message:
      "devbox has no Codex: add it there, or move the Thread to another Harness first.",
  })
  const { way, methods } = machines({ "agents.unpack_thread": none })
  await expect(carry(way, goes)).rejects.toThrow(
    "devbox has no Codex: add it there, or move the Thread to another Harness first. The folder's work is on devbox already, on feat/x."
  )
  expect(methods()).not.toContain("m1pro agents.leave_thread")
  expect(methods()).not.toContain("devbox agents.give_back")
})

test("a message that is not sent comes back with its words, after the Thread moved", async () => {
  const away = new Refused({ code: "conflict", message: "The Thread is held" })
  const { way, methods } = machines({ "agents.send": away })
  const failed = await carry(way, goes, { message: "go on" }).catch(
    (error: unknown) => error
  )
  expect(failed).toBeInstanceOf(Unsent)
  expect((failed as Unsent).words).toBe("go on")
  expect((failed as Unsent).message).toBe("The Thread is held.")
  expect(methods()).toContain("m1pro agents.leave_thread")
})
