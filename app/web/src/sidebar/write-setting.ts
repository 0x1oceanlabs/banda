import { tomlOf } from "@banda/contract/settings"

/** Writes `key` of a settings file from a sidebar menu; the look brings
 * the change back, and what went wrong goes to the console. */
export function writeSetting(file: string, key: string, value: string) {
  window.banda?.settings.set(file, key, tomlOf(value)).then(
    (refused) => {
      if (refused.length > 0) console.error(`banda: ${file} refused`, refused)
    },
    (error: unknown) => console.error(`banda: ${file} was not written`, error)
  )
}
