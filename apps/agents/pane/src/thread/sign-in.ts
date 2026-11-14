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

/**
 * The ways of `ways` a card shows, the Harness being on another machine
 * or not (ADR 0120, decision 3). There, one for another machine's window
 * stands for what the Harness does by itself, which would open a browser
 * no one sees; here those are left out, and nothing changes. `unseen`
 * says that the Harness has a way of its own with nothing to stand for it.
 */
export function waysShown<
  Way extends { terminal?: unknown; elsewhere: boolean },
>(ways: readonly Way[], elsewhere: boolean): { ways: Way[]; unseen: boolean } {
  if (!elsewhere)
    return { ways: ways.filter((way) => !way.elsewhere), unseen: false }
  const shown = ways.filter((way) => way.terminal)
  return {
    ways: shown,
    unseen: shown.length < ways.length && !ways.some((way) => way.elsewhere),
  }
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
