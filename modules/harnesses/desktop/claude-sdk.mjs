// The Agent SDK as the carried Claude Code adapter sees it: adapters.mjs
// bundles this in place of `@anthropic-ai/claude-agent-sdk`, which it
// reaches as `banda:claude-agent-sdk`. When the engine names a folder in
// BANDA_CLAUDE_SESSIONS, the Project's, each call that takes a
// `sessionStore` gets Banda's (src/sessions.ts), so any Claude account
// goes on with a Thread's session (ADR 0078, decision 3). Without it, the
// SDK is as it was. In a Project the Person has not trusted, the adapter's
// own reads of the settings take the Person's alone (src/trust.ts).
import { homedir } from "node:os"
import { join } from "node:path"
import * as sdk from "banda:claude-agent-sdk"
import { copySession, folderStore, onDisk } from "./src/sessions.ts"
import { resolving, untrusted } from "./src/trust.ts"

export * from "banda:claude-agent-sdk"

const notTrusted = untrusted(process.env)
export const resolveSettings = (options) =>
  sdk.resolveSettings(resolving(options, notTrusted))

const folder = process.env.BANDA_CLAUDE_SESSIONS || undefined
// A session from before Banda kept them, or a fork the SDK made on disk,
// comes in from the account's disk on its first read.
const store =
  folder &&
  folderStore(folder, (sessionId, into) =>
    sdk.importSessionToStore(sessionId, into)
  )

/** `options` with Banda's store, unless the caller gave one. */
const kept = (options) =>
  store && options?.sessionStore === undefined
    ? { ...options, sessionStore: store }
    : options

export const query = (params) =>
  sdk.query(store ? { ...params, options: kept(params.options) } : params)
export const getSessionMessages = (id, options) =>
  sdk.getSessionMessages(id, kept(options))
export const getSessionInfo = (id, options) =>
  sdk.getSessionInfo(id, kept(options))
export const getSubagentMessages = (id, agent, options) =>
  sdk.getSubagentMessages(id, agent, kept(options))
export const listSubagents = (id, options) =>
  sdk.listSubagents(id, kept(options))
export const renameSession = (id, title, options) =>
  sdk.renameSession(id, title, kept(options))
export const tagSession = (id, tag, options) =>
  sdk.tagSession(id, tag, kept(options))
export const deleteSession = (id, options) =>
  sdk.deleteSession(id, kept(options))

// The SDK forks only a session on the account's disk, which may miss the
// turns another account ran: the store's copy goes there first.
export const forkSession = async (id, options) => {
  if (store)
    await onDisk(
      store,
      id,
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
    )
  return sdk.forkSession(id, options)
}

// The adapter reads a whole session through an import of its own (its
// fork point): from the store when the session lives there.
export const importSessionToStore = async (id, into, options) => {
  if (store && (await copySession(store, id, into, options))) return
  return sdk.importSessionToStore(id, into, options)
}
