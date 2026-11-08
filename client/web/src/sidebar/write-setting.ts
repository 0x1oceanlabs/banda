import { tomlOf } from "@banda/contract/settings"

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

/** Writes `key` of a settings file from a sidebar menu; the look brings
 * the change back, and what went wrong goes to the console. */
export function writeSetting(file: string, key: string, value: string) {
  logged(file, window.banda?.settings.set(file, key, tomlOf(value)))
}
