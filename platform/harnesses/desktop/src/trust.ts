// What the carried Claude Code adapter reads of Claude Code's settings
// itself, for its models, effort and modes, through the Agent SDK's
// `resolveSettings`. In a Project the Person has not trusted, the engine
// sets BANDA_UNTRUSTED on the adapter's process, and the adapter reads the
// Person's own settings alone, as its sessions do (ADR 0083, decision 5).
// The shim of the SDK passes every call through `resolving`
// (`claude-sdk.mjs`).

/** Whether the engine said the adapter's Project is not trusted. */
export const untrusted = (env: NodeJS.ProcessEnv) =>
  Boolean(env.BANDA_UNTRUSTED)

/** `options` for `resolveSettings`: in a Project not trusted, the Person's
 * own settings alone, unless the caller named its sources. */
export const resolving = (
  options: Record<string, unknown> | undefined,
  notTrusted: boolean
) =>
  notTrusted && options?.settingSources === undefined
    ? { ...options, settingSources: ["user"] }
    : options
