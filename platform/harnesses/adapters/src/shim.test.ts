/**
 * Banda's shim of Claude's Agent SDK (`claude-sdk.mjs`), as the carried
 * Claude Code adapter calls it once `build.mjs` has bundled it in the
 * SDK's place: here over a stand-in of the SDK.
 */
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"

/** The SDK the shim reaches, as `banda:claude-agent-sdk`: each call
 * answers what it was given. */
const sdk = vi.hoisted(() => ({
  query: vi.fn((params: unknown) => params),
  getSessionMessages: vi.fn((_id: string, options?: unknown) => options),
  resolveSettings: vi.fn((options?: unknown) => options),
  importSessionToStore: vi.fn(),
}))
vi.mock("banda:claude-agent-sdk", () => sdk)

/** The shim as the adapter's process starts with `env`: it reads its
 * environment once, as it loads. */
async function shim(env: Record<string, string>) {
  vi.resetModules()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  return import("../claude-sdk.mjs")
}

afterEach(() => vi.unstubAllEnvs())

type Options = { sessionStore?: unknown; settingSources?: string[] }

test("with the Project's folder named, each call that takes a store gets Banda's, unless it names its own", async () => {
  const folder = await mkdtemp(join(tmpdir(), "banda-sessions-"))
  const { query, getSessionMessages } = await shim({
    BANDA_CLAUDE_SESSIONS: folder,
  })
  const asked = query({ prompt: "hi", options: { cwd: "/p" } }) as {
    options: Options
  }
  const store = asked.options.sessionStore as { append?: unknown }
  expect(typeof store?.append).toBe("function")
  expect(asked.options).toMatchObject({ cwd: "/p" })
  expect(
    (getSessionMessages("1af9c91d-1e0c-41ca-a408-b8cd95a8f4ef") as Options)
      .sessionStore
  ).toBe(store)
  const own = { append: async () => {} }
  const kept = query({ prompt: "hi", options: { sessionStore: own } }) as {
    options: Options
  }
  expect(kept.options.sessionStore).toBe(own)
})

test("without it, the SDK is as it was", async () => {
  const { query } = await shim({ BANDA_CLAUDE_SESSIONS: "" })
  const params = { prompt: "hi", options: { cwd: "/p" } }
  expect(query(params)).toBe(params)
})

test("in a Project not trusted, the adapter's own read of the settings takes the Person's alone", async () => {
  const trusted = await shim({ BANDA_UNTRUSTED: "" })
  expect(trusted.resolveSettings({ cwd: "/p" })).toEqual({ cwd: "/p" })
  const not = await shim({ BANDA_UNTRUSTED: "1" })
  expect(not.resolveSettings({ cwd: "/p" })).toEqual({
    cwd: "/p",
    settingSources: ["user"],
  })
})
