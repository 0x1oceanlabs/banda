import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { copySession, type Entry, folderStore, onDisk } from "./sessions"

const folder = () => mkdtemp(join(tmpdir(), "banda-sessions-"))
const entry = (n: number): Entry => ({ type: "user", uuid: `u${n}`, n })
const session = "1af9c91d-1e0c-41ca-a408-b8cd95a8f4ef"

test("a session reads back as it was written, in the order it was written", async () => {
  const store = folderStore(await folder())
  const key = { projectKey: "-home-a-work", sessionId: session }
  expect(await store.load(key)).toBeNull()
  // The SDK sends its batches without waiting for each.
  await Promise.all(
    [1, 2, 3].map((n) => store.append(key, [entry(n), entry(n + 10)]))
  )
  expect((await store.load(key))?.map((e) => e.n)).toEqual([
    1, 11, 2, 12, 3, 13,
  ])
})

test("a session is found by its ID under any project key", async () => {
  const store = folderStore(await folder())
  await store.append({ projectKey: "-home-a-work", sessionId: session }, [
    entry(1),
  ])
  // The adapter reads a session without its folder; the SDK guesses one.
  const elsewhere = await store.load({ projectKey: "-tmp", sessionId: session })
  expect(elsewhere?.map((e) => e.uuid)).toEqual(["u1"])
  expect(await store.listSessions("-home-a-work")).toEqual([
    { sessionId: session, mtime: expect.any(Number) },
  ])
  expect(await store.listSessions("-tmp")).toEqual([])
})

test("a subagent's transcript is the session's, under its subpath", async () => {
  const store = folderStore(await folder())
  const main = { projectKey: "p", sessionId: session }
  await store.append(main, [entry(1)])
  await store.append({ ...main, subpath: "subagents/agent-a1" }, [entry(2)])
  expect(await store.listSubkeys(main)).toEqual(["subagents/agent-a1"])
  const sub = await store.load({ ...main, subpath: "subagents/agent-a1" })
  expect(sub?.map((e) => e.n)).toEqual([2])
  await store.delete(main)
  expect(await store.load(main)).toBeNull()
  expect(await store.listSubkeys(main)).toEqual([])
  expect(await store.listSessions("p")).toEqual([])
})

test("a key never reaches out of its folder", async () => {
  const store = folderStore(await folder())
  await expect(
    store.load({ projectKey: "p", sessionId: "../../etc/passwd" })
  ).rejects.toThrow("not a session ID")
  const key = { projectKey: "../..", sessionId: session, subpath: "../../x" }
  await store.append({ projectKey: "../..", sessionId: session }, [entry(1)])
  await store.append(key, [entry(2)])
  expect(await store.listSubkeys(key)).toEqual(["../../x"])
  expect(await store.listSessions("../..")).toHaveLength(1)
})

test("a session kept here copies into another store, as a fork reads it", async () => {
  const store = folderStore(await folder())
  const main = { projectKey: "p", sessionId: session }
  await store.append(main, [entry(1), entry(2), entry(3)])
  await store.append({ ...main, subpath: "subagents/a" }, [entry(4)])
  const got: { key: string; n: unknown[] }[] = []
  const into = {
    append: async (
      key: { sessionId: string; subpath?: string },
      entries: Entry[]
    ) => {
      got.push({ key: key.subpath ?? "main", n: entries.map((e) => e.n) })
    },
  }
  expect(
    await copySession(store, session, into, {
      includeSubagents: false,
      batchSize: 2,
    })
  ).toBe(true)
  expect(got).toEqual([
    { key: "main", n: [1, 2] },
    { key: "main", n: [3] },
  ])
  expect(
    await copySession(store, "00000000-0000-0000-0000-000000000000", into)
  ).toBe(false)
})

test("a session not kept yet is brought in on its first read", async () => {
  const asked: string[] = []
  const store = folderStore(await folder(), async (sessionId, into) => {
    asked.push(sessionId)
    // As the SDK imports one from the account's disk.
    if (sessionId === session)
      await into.append({ projectKey: "-home-a", sessionId }, [entry(7)])
    else throw new Error("No conversation found")
  })
  const read = await store.load({ projectKey: "-tmp", sessionId: session })
  expect(read?.map((e) => e.n)).toEqual([7])
  await store.load({ projectKey: "-tmp", sessionId: session })
  expect(asked, "once: then it is here").toEqual([session])
  const nowhere = "00000000-0000-0000-0000-000000000000"
  expect(
    await store.load({ projectKey: "-tmp", sessionId: nowhere })
  ).toBeNull()
  expect(await store.projectKeyOf(session)).toBe("-home-a")
  expect(await store.projectKeyOf(nowhere)).toBeUndefined()
})

test("a session kept here goes onto an account's disk for a fork", async () => {
  const store = folderStore(await folder())
  await store.append({ projectKey: "-home-a-work", sessionId: session }, [
    entry(1),
    entry(2),
  ])
  const config = await folder()
  expect(await onDisk(store, session, config)).toBe(true)
  const path = join(config, "projects", "-home-a-work", `${session}.jsonl`)
  const written = (await readFile(path, "utf8")).trim().split("\n")
  expect(written.map((line) => JSON.parse(line).n)).toEqual([1, 2])
  // Another account ran a turn since: the account's copy misses it.
  await store.append({ projectKey: "-home-a-work", sessionId: session }, [
    entry(3),
  ])
  expect(await onDisk(store, session, config)).toBe(true)
  expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(3)
  expect(
    await onDisk(store, "00000000-0000-0000-0000-000000000000", config)
  ).toBe(false)
})
