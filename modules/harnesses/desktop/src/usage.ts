/**
 * Claude Code's usage limits (ADR 0043, decision 2). The engine part asks
 * this, with the folder Claude Code keeps its sign-in in; this reads the
 * access token there, or in the macOS Keychain, asks Anthropic once with
 * it, and answers what Anthropic said with the plan the sign-in names.
 *
 * The token lives only in this one request: it is kept nowhere, written
 * in no log, sent nowhere but Anthropic's usage endpoint, never renewed,
 * and never in the answer. Claude Code renews its own sign-in as it runs.
 */
import type { WindowRequest } from "@banda/contract"
import { Refused } from "@banda/desktop-kit"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { join } from "node:path"

/** Where Claude Code's limits are read: the one place the token goes. */
export const USAGE = "https://api.anthropic.com/api/oauth/usage"

/** How long Anthropic may take to answer. */
const ANSWERING = 10_000

/** What the engine part reads, and no token. */
export type Answer = {
  signed_in: boolean
  subscription?: string
  tier?: string
  expired?: boolean
  status?: number
  body?: unknown
}

export type Fetch = (
  url: string,
  init: {
    headers: Record<string, string>
    redirect: "error"
    signal: AbortSignal
  }
) => Promise<{ status: number; json: () => Promise<unknown> }>

/** What reading and asking take, so a test gives its own. */
export type Means = {
  platform: NodeJS.Platform
  home: string
  /** `CLAUDE_CONFIG_DIR` of main's environment, if set. */
  configured?: string
  /** A file's text; none when it is not there. */
  read: (path: string) => Promise<string | undefined>
  /** A macOS Keychain item's secret, by its service; none when it is not there. */
  keychain: (service: string) => Promise<string | undefined>
  fetch: Fetch
  now: () => number
}

type Login = {
  accessToken?: unknown
  expiresAt?: unknown
  subscriptionType?: unknown
  rateLimitTier?: unknown
}

/**
 * The Keychain item Claude Code keeps its sign-in in on macOS: a folder
 * other than its default one has its own, named by its hash.
 */
export const service = (folder: string, standard: boolean) =>
  standard
    ? "Claude Code-credentials"
    : `Claude Code-credentials-${createHash("sha256").update(folder).digest("hex").slice(0, 8)}`

/** Claude Code's sign-in in `folder`, where it keeps it on this system. */
const login = async (
  means: Means,
  folder: string,
  standard: boolean
): Promise<Login | undefined> => {
  const kept =
    (means.platform === "darwin"
      ? await means.keychain(service(folder, standard))
      : undefined) ?? (await means.read(join(folder, ".credentials.json")))
  if (kept === undefined) return undefined
  const oauth: unknown = (JSON.parse(kept) as { claudeAiOauth?: unknown })
    .claudeAiOauth
  return typeof oauth === "object" && oauth !== null
    ? (oauth as Login)
    : undefined
}

const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined

/** Reads the sign-in in `config`, else Claude Code's own folder, and asks. */
export const usage = async (
  means: Means,
  config: string | undefined,
  signal: AbortSignal
): Promise<Answer> => {
  const standardFolder = join(means.home, ".claude")
  const folder = config ?? means.configured ?? standardFolder
  const found = await login(means, folder, folder === standardFolder)
  const token = text(found?.accessToken)
  if (found === undefined || token === undefined) return { signed_in: false }
  const plan = {
    signed_in: true,
    subscription: text(found.subscriptionType),
    tier: text(found.rateLimitTier),
  }
  const expires = found.expiresAt
  if (typeof expires === "number" && expires <= means.now())
    return { ...plan, expired: true }
  const response = await means.fetch(USAGE, {
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(ANSWERING)]),
  })
  const body =
    response.status === 200
      ? await response.json().catch(() => undefined)
      : undefined
  return { ...plan, status: response.status, body }
}

/** Answers the engine part's `claude_usage`. */
export const asking = (means: () => Means) => (request: WindowRequest) =>
  Effect.tryPromise({
    try: (signal) => {
      const { config } = request.params as { config?: unknown }
      return usage(means(), text(config), signal)
    },
    catch: (error) =>
      new Refused({
        // The error names no token: what threw is the file, the
        // Keychain or the network, never the request's headers.
        message: `Anthropic was not reached: ${error instanceof Error ? error.message : String(error)}.`,
      }),
  })
