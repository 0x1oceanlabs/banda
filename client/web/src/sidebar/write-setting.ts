import type { JsonValue } from "@banda/contract"
import { tomlOf } from "@banda/contract/settings"
import type { WindowApi } from "@banda/ui/module"

/** What a write of a settings file came to, to the console where it went
 * wrong: the look brings a change back, so nothing else waits on it. */
export function logged(
  file: string,
  writing: Promise<readonly unknown[]> | undefined
) {
  writing?.then(
    (refused) => {
      if (refused.length > 0) console.error(`banda: ${file} refused`, refused)
    },
    (error: unknown) => console.error(`banda: ${file} was not written`, error)
  )
}

/** How a settings file's key is written: `banda settings set`. */
export type Write = WindowApi["writeSetting"]

const SIDEBAR = "sidebar.toml"

/** Writes `key` of sidebar.toml as `value`; the look brings it back. */
export function writeSidebar(write: Write, key: string, value: JsonValue) {
  logged(SIDEBAR, write(SIDEBAR, key, tomlOf(value)))
}
