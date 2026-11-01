import type { Program } from "@bandaso/contract/agents"
import type { Ended } from "@bandaso/contract/terminal"

/**
 * A program as a line a Person can paste into a shell: what it adds to
 * the environment first, then the program and its arguments, each word
 * quoted when the shell would read it otherwise.
 */
export function commandLine({ program, args, env }: Program): string {
  const set = Object.entries(env).map(([key, value]) => `${key}=${word(value)}`)
  return [...set, word(program), ...args.map(word)].join(" ")
}

function word(text: string): string {
  return /^[\w@%+:,./-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", `'\\''`)}'`
}

/**
 * What a Person reads when a sign-in in a terminal ended without signing
 * in, or `null` when it ended with code 0, which says it worked.
 */
export function signInFailed(ended: Ended): string | null {
  if (ended.code === 0) return null
  if (ended.code !== undefined)
    return `The sign-in ended with code ${ended.code}. Try again.`
  return "The sign-in was stopped before it ended. Try again."
}
