import type { Program } from "@banda/contract"

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
 * A line as the shell splits it into words, the way {@link commandLine}
 * writes them: spaces between, quotes keeping spaces in, a backslash
 * keeping the next character. Nothing is expanded.
 */
export function wordsOf(line: string): string[] {
  const words: string[] = []
  let word: string | undefined
  let quote: "'" | '"' | undefined
  for (let at = 0; at < line.length; at++) {
    const c = line[at]!
    if (quote) {
      if (c === quote) quote = undefined
      else if (
        c === "\\" &&
        quote === '"' &&
        /["\\$`]/.test(line[at + 1] ?? "")
      )
        word += line[++at]!
      else word += c
    } else if (/\s/.test(c)) {
      if (word !== undefined) words.push(word)
      word = undefined
    } else {
      word ??= ""
      if (c === "'" || c === '"') quote = c
      else if (c === "\\") word += line[++at] ?? ""
      else word += c
    }
  }
  if (word !== undefined) words.push(word)
  return words
}
