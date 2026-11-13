import type { JsonValue } from "@banda/contract"
import { tomlOf } from "@banda/contract/settings"
import { logged, type Write } from "../settings/write"

const SIDEBAR = "sidebar.toml"

/** Writes `key` of sidebar.toml as `value`; the look brings it back. */
export function writeSidebar(write: Write, key: string, value: JsonValue) {
  logged(SIDEBAR, write(SIDEBAR, key, tomlOf(value)))
}
