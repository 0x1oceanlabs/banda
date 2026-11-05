/** The languages Shiki colours: in a reply's code and the composer's. */
import { bundledLanguagesInfo } from "shiki"

/** Each language by its name. */
export const LANGUAGES = [...bundledLanguagesInfo].sort((a, b) =>
  a.name.localeCompare(b.name)
)

/** Each name a language goes by, to its Shiki id. */
export const ALIASES: ReadonlyMap<string, string> = new Map(
  LANGUAGES.flatMap(({ id, aliases = [] }) =>
    [id, ...aliases].map((name) => [name, id] as const)
  )
)
