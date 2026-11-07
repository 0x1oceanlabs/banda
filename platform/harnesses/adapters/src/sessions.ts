// Claude Code's sessions in a folder Banda keeps for the Project, not in
// an account's own CLAUDE_CONFIG_DIR, so that any Claude account goes on
// with a Thread's session (ADR 0078, decision 3). The Agent SDK mirrors
// every transcript entry here and reads a session back from here to
// resume it (its `sessionStore`, @alpha). The carried adapter is bundled
// with a shim of the SDK that passes this store to each call that takes
// one (`claude-sdk.mjs`, `build.mjs`).
//
// A session is found by its ID, a UUID, whatever project key a call
// names: the adapter reads a session without saying its folder, and the
// SDK then guesses the key. The key is kept to list a project's sessions,
// and to know the session's folder on an account's disk.
//
//   <root>/<session>.jsonl                 its transcript, one entry a line
//   <root>/<session>/<subpath>.jsonl       a subagent's, by its subpath
//   <root>/keys/<project key>/<session>    the project key it was written under
//
// A session not here yet, one from before Banda kept them or a fork the
// SDK made on disk, comes in on its first read (`bringIn`). A fork needs
// its source on the account's own disk, which `onDisk` writes.

import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"

/** Where the SDK keeps one transcript: its project, session and, for a
 * subagent's, its subpath. */
export type SessionKey = {
  projectKey: string
  sessionId: string
  subpath?: string
}

/** One line of a transcript, as the SDK passes it: JSON, kept as is. */
export type Entry = { type: string } & Record<string, unknown>

/** The SDK's `SessionStore`, as this folder answers it. */
export type SessionStore = {
  append(key: SessionKey, entries: Entry[]): Promise<void>
  load(key: SessionKey): Promise<Entry[] | null>
  listSessions(
    projectKey: string
  ): Promise<{ sessionId: string; mtime: number }[]>
  listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]>
  delete(key: SessionKey): Promise<void>
}

/** The sessions of one folder, and what only a folder can say. */
export type FolderStore = SessionStore & {
  /** The project key session `sessionId` was written under, if it is here. */
  projectKeyOf(sessionId: string): Promise<string | undefined>
}

/** A name safe as one path segment: a key may hold `/` and `..`. */
const segment = (text: string) =>
  encodeURIComponent(text).replaceAll(".", "%2E")
const unsegment = (name: string) => decodeURIComponent(name)

/** A session ID as the file it names: one segment, never a path. */
const id = (session: string) => {
  if (!session || session !== segment(session))
    throw new Error(`not a session ID: ${session}`)
  return session
}

const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT"

/** What `read` answers, or `none` where the file is not there. */
async function orNone<T, N>(read: () => Promise<T>, none: N): Promise<T | N> {
  try {
    return await read()
  } catch (error) {
    if (absent(error)) return none
    throw error
  }
}

const lines = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Entry)

/** The sessions kept in `root`, made when first written to. `bringIn`
 * brings a session here from elsewhere when a read does not find it. */
export function folderStore(
  root: string,
  bringIn?: (sessionId: string, into: SessionStore) => Promise<void>
): FolderStore {
  const file = ({
    sessionId,
    subpath,
  }: Pick<SessionKey, "sessionId" | "subpath">) =>
    subpath === undefined
      ? join(root, `${id(sessionId)}.jsonl`)
      : join(root, id(sessionId), `${segment(subpath)}.jsonl`)
  // Appends to one file go in the order they were asked for: the SDK
  // does not wait for one batch before it sends the next.
  const queues = new Map<string, Promise<void>>()
  const queued = (path: string, work: () => Promise<void>) => {
    const next = (queues.get(path) ?? Promise.resolve()).then(work, work)
    queues.set(path, next)
    void next.finally(() => queues.get(path) === next && queues.delete(path))
    return next
  }
  const read = async (key: SessionKey) => {
    const path = file(key)
    await queues.get(path)
    return orNone(async () => lines(await readFile(path, "utf8")), null)
  }
  const store: FolderStore = {
    async append(key, entries) {
      if (entries.length === 0) return
      const path = file(key)
      const text = entries.map((entry) => JSON.stringify(entry) + "\n").join("")
      await queued(path, async () => {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, text)
        if (key.subpath === undefined) {
          const mark = join(
            root,
            "keys",
            segment(key.projectKey),
            key.sessionId
          )
          await mkdir(dirname(mark), { recursive: true })
          await writeFile(mark, "")
        }
      })
    },
    async load(key) {
      const found = await read(key)
      if (found !== null || key.subpath !== undefined || !bringIn) return found
      // Brought in once: a failure means the session is nowhere.
      await bringIn(key.sessionId, store).catch(() => undefined)
      return read(key)
    },
    async listSessions(projectKey) {
      const names = await orNone(
        () => readdir(join(root, "keys", segment(projectKey))),
        []
      )
      const found = await Promise.all(
        names.map((sessionId) =>
          orNone(async () => {
            const { mtimeMs } = await stat(file({ sessionId }))
            return { sessionId, mtime: Math.floor(mtimeMs) }
          }, undefined)
        )
      )
      return found.filter((one) => one !== undefined)
    },
    async listSubkeys({ sessionId }) {
      const names = await orNone(() => readdir(join(root, id(sessionId))), [])
      return names
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => unsegment(name.slice(0, -".jsonl".length)))
    },
    async delete(key) {
      await rm(file(key), { force: true })
      if (key.subpath !== undefined) return
      await rm(join(root, id(key.sessionId)), { recursive: true, force: true })
      await rm(join(root, "keys", segment(key.projectKey), key.sessionId), {
        force: true,
      })
    },
    async projectKeyOf(sessionId) {
      id(sessionId)
      const keys = await orNone(() => readdir(join(root, "keys")), [])
      for (const key of keys) {
        const here = await orNone(
          () => access(join(root, "keys", key, sessionId)),
          false
        )
        if (here !== false) return unsegment(key)
      }
      return undefined
    },
  }
  return store
}

/** Copies session `sessionId` from `store` into `into`, as the SDK's
 * `importSessionToStore` copies one from disk: for a fork of a session
 * that lives only here. Answers whether `store` had it. */
export async function copySession(
  store: SessionStore,
  sessionId: string,
  into: Pick<SessionStore, "append">,
  options: {
    includeSubagents?: boolean
    batchSize?: number
    projectKey?: string
  } = {}
): Promise<boolean> {
  const projectKey = options.projectKey ?? "banda"
  const main = await store.load({ projectKey, sessionId })
  if (main === null) return false
  const size = Math.max(1, options.batchSize ?? 500)
  const send = async (key: SessionKey, entries: Entry[]) => {
    for (let at = 0; at < entries.length; at += size) {
      await into.append(key, entries.slice(at, at + size))
    }
  }
  await send({ projectKey, sessionId }, main)
  if (options.includeSubagents !== false) {
    for (const subpath of await store.listSubkeys({ projectKey, sessionId })) {
      const entries = await store.load({ projectKey, sessionId, subpath })
      if (entries) await send({ projectKey, sessionId, subpath }, entries)
    }
  }
  return true
}

/** Writes session `sessionId` from `store` into the account's own folder
 * `config`, where Claude Code keeps it (`projects/<project key>/`): the
 * SDK forks only a session on disk. The store's copy goes over the
 * account's, which misses the turns other accounts ran. Answers whether
 * it is on disk now. */
export async function onDisk(
  store: FolderStore,
  sessionId: string,
  config: string
): Promise<boolean> {
  const projectKey = await store.projectKeyOf(sessionId)
  if (projectKey === undefined) return false
  const folder = join(
    config,
    "projects",
    segment(projectKey).replaceAll("%2E", ".")
  )
  const path = join(folder, `${id(sessionId)}.jsonl`)
  const entries = await store.load({ projectKey, sessionId })
  if (entries === null) return false
  await mkdir(folder, { recursive: true })
  await writeFile(
    path,
    entries.map((entry) => JSON.stringify(entry) + "\n").join("")
  )
  return true
}
