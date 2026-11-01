import type { Program } from "@banda/contract/agents"

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
