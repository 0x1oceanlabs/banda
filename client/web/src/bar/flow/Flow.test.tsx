import type { Engine } from "@banda/contract"
import type { Flow } from "@banda/contract/workspaces"
import { DEFAULT_KEYS } from "@banda/contract/look"
import { KeysInForce } from "@banda/ui/hooks/use-key-of"
import { type Key, keyLabel } from "@banda/ui/lib/keys"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { FlowContext } from "../../tiling/kept"
import { flowWidget, isFlow, nextFlow } from "./Flow"

/** The widget drawn in `flow`, with `flow.solo` on `key`. */
function drawn(flow: Flow, key?: Key): string {
  const { Widget } = flowWidget
  // The Flow this device shows, as the Window's `Kept` gives it:
  // tiling.toml's, and the device's own Solo.
  return renderToStaticMarkup(
    <FlowContext value={flow}>
      <KeysInForce
        value={{
          mod: DEFAULT_KEYS.mod,
          byAction: new Map(key ? [["flow.solo", key]] : []),
          byScope: new Map(),
        }}
      >
        <Widget engine={{} as Engine} projects={[]} />
      </KeysInForce>
    </FlowContext>
  )
}

test("Alt+Shift+M goes from the row to solo and back, and from free to solo (ADR 0079)", () => {
  expect(nextFlow("row")).toBe("solo")
  expect(nextFlow("solo")).toBe("row")
  expect(nextFlow("free")).toBe("solo")
})

test("flow.pick takes the three Flows by name, and no other word", () => {
  for (const flow of ["free", "row", "solo"]) expect(isFlow(flow)).toBe(true)
  for (const word of ["toString", "Row", "", 1, undefined])
    expect(isFlow(word)).toBe(false)
})

test("its icon is the Flow in force, named with Alt+Shift+M, and its menu is shut until asked for", () => {
  const key: Key = { code: "KeyM", alt: true, shift: true }
  const icons: Record<Flow, string> = {
    free: "lucide-layout-dashboard",
    row: "lucide-columns-3",
    solo: "lucide-rectangle-horizontal",
  }
  for (const [flow, icon] of Object.entries(icons) as [Flow, string][]) {
    const html = drawn(flow, key)
    expect(html).toContain(icon)
    for (const other of Object.values(icons))
      if (other !== icon) expect(html).not.toContain(other)
  }
  const html = drawn("solo", key)
  expect(html).toContain('aria-label="Flow: Solo"')
  expect(html).toContain(`title="Flow: Solo (${keyLabel(key)})"`)
  expect(html).toContain('aria-haspopup="menu"')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('role="menu"')
  // Unbound, it names no key.
  expect(drawn("row")).toContain('title="Flow: Row"')
})
