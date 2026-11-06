/**
 * A markdown file's front matter, the YAML between `---` lines at its
 * top, as ADRs and many sites write it: rendered, it would read as a rule
 * and a heading. Pure, so plain tests cover it.
 */

/** Its front matter's plain `key: value` lines, and the rest; none when
 * it has no front matter. */
export function frontMatter(text: string): {
  facts: [string, string][]
  body: string
} | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return null
  const facts = match[1]
    .split(/\r?\n/)
    .map((line) => /^([\w-]+):[ \t]*(.*)$/.exec(line))
    .filter((fact) => fact !== null)
    .map(([, key, value]): [string, string] => [
      key,
      value.replace(/^(["'])(.*)\1$/, "$2"),
    ])
  return { facts, body: text.slice(match[0].length) }
}
