import { expect, test } from "vitest"
import { type Means, service, USAGE, usage } from "./usage"

const NOW = 1_793_800_000_000
const login = (oauth: object) => JSON.stringify({ claudeAiOauth: oauth })
const signed = {
  accessToken: "sk-ant-oat01-secret",
  expiresAt: NOW + 60_000,
  subscriptionType: "max",
  rateLimitTier: "default_claude_max_20x",
}

type Asked = { url: string; headers: Record<string, string>; redirect: string }

/** Means over `files` and `items`, with Anthropic answering `status`. */
const means = (
  files: Record<string, string>,
  {
    status = 200,
    platform = "linux" as NodeJS.Platform,
    items = {} as Record<string, string>,
  } = {}
) => {
  const asked: Asked[] = []
  const given: Means = {
    platform,
    home: "/home/p",
    read: async (path) => files[path],
    keychain: async (name) => items[name],
    fetch: async (url, init) => {
      asked.push({ url, headers: init.headers, redirect: init.redirect })
      return { status, json: async () => ({ five_hour: { utilization: 3 } }) }
    },
    now: () => NOW,
  }
  return { given, asked }
}

const signal = new AbortController().signal

test("the sign-in in Claude Code's folder asks Anthropic once, and the answer holds no token", async () => {
  const { given, asked } = means({
    "/home/p/.claude/.credentials.json": login(signed),
  })
  const answer = await usage(given, undefined, signal)
  expect(answer).toEqual({
    signed_in: true,
    subscription: "max",
    tier: "default_claude_max_20x",
    status: 200,
    body: { five_hour: { utilization: 3 } },
  })
  expect(JSON.stringify(answer)).not.toContain("secret")
  expect(asked).toEqual([
    {
      url: USAGE,
      headers: {
        authorization: "Bearer sk-ant-oat01-secret",
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
      redirect: "error",
    },
  ])
})

test("an entry's own folder is read, and an expired or missing sign-in asks nothing", async () => {
  const expired = { ...signed, expiresAt: NOW - 1 }
  const files = { "/work/.credentials.json": login(expired) }
  const { given, asked } = means(files)
  expect(await usage(given, "/work", signal)).toMatchObject({
    signed_in: true,
    expired: true,
  })
  expect(await usage(given, undefined, signal)).toEqual({ signed_in: false })
  expect(asked).toEqual([])
})

test("on macOS the Keychain holds it, under the folder's own item", async () => {
  expect(service("/home/p/.claude", true)).toBe("Claude Code-credentials")
  expect(service("/work", false)).toMatch(
    /^Claude Code-credentials-[0-9a-f]{8}$/
  )
  const items = { "Claude Code-credentials": login(signed) }
  const { given, asked } = means({}, { platform: "darwin", items, status: 429 })
  expect(await usage(given, undefined, signal)).toMatchObject({
    status: 429,
    body: undefined,
  })
  expect(asked).toHaveLength(1)
})
