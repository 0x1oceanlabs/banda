import { describe, expect, test, vi } from "vitest"
import type { Look } from "@banda/contract/look"
import type { Listed } from "@banda/contract/look"
import { BEFORE, themeDetail, themeNowOf, themeRows, writeLook } from "./theme"

/** A look with the theme layers `names`, its schemes and look.toml's
 * keys: only what the theme's rows read of it. */
const lookOf = (
  names: { name: string; origin: "banda" | "yours" | "current" }[],
  schemes: ("light" | "dark")[],
  mine: Record<string, string> = {},
  mode: Look["mode"] = "system"
) =>
  ({
    mode,
    schemes: Object.fromEntries(schemes.map((one) => [one, {}])),
    sources: names.map((one) => ({ layer: "theme", ...one })),
    settings: {
      "look.toml": Object.fromEntries(
        Object.entries(mine).map(([key, value]) => [key, { value }])
      ),
    },
  }) as unknown as Look

describe("the theme in force", () => {
  test("before the look comes: as the system, with both schemes", () => {
    expect(themeNowOf(null)).toEqual(BEFORE)
    expect(themeDetail(BEFORE)).toBe("As the system")
  })

  test("a look.toml with no theme takes this device's, the default, and names the theme it takes: Banda's own pair, as the system shows it", () => {
    const banda = lookOf(
      [
        { name: "banda-light", origin: "banda" },
        { name: "banda-dark", origin: "banda" },
      ],
      ["light", "dark"]
    )
    expect(themeNowOf(banda)).toEqual({
      theme: "platform",
      label: "Banda",
      mode: "system",
      both: true,
      only: undefined,
    })
    expect(themeDetail(themeNowOf(banda))).toBe("Banda · As the system")
  })

  test("Banda's own are named as the menu names them, not as their files (ADR 0100, decision 2)", () => {
    const macos = lookOf(
      [
        { name: "macos-light", origin: "banda" },
        { name: "macos-dark", origin: "banda" },
      ],
      ["light", "dark"],
      { theme: "macos", mode: "dark" },
      "dark"
    )
    expect(themeNowOf(macos)).toMatchObject({
      theme: "macos",
      label: "Banda macOS",
    })
    expect(themeDetail(themeNowOf(macos))).toBe("Banda macOS · Dark")
  })

  test("look.toml's own theme and scheme win; a theme with one scheme says so", () => {
    const night = lookOf(
      [{ name: "night", origin: "yours" }],
      ["dark"],
      { theme: "night", mode: "dark" },
      "dark"
    )
    expect(themeNowOf(night)).toMatchObject({
      theme: "night",
      mode: "dark",
      both: false,
      only: "dark",
    })
    expect(themeDetail(themeNowOf(night))).toBe("night · dark only")
  })

  test('"platform", the default, names the theme this device takes, as an unset theme does (ADR 0100, decision 2)', () => {
    const omarchy = lookOf([{ name: "omarchy", origin: "current" }], ["dark"], {
      theme: "platform",
    })
    expect(themeNowOf(omarchy)).toMatchObject({
      theme: "platform",
      label: "Banda Omarchy",
    })
    const banda = lookOf(
      [
        { name: "banda-light", origin: "banda" },
        { name: "banda-dark", origin: "banda" },
      ],
      ["light", "dark"],
      { theme: "platform" }
    )
    expect(themeDetail(themeNowOf(banda))).toBe("Banda · As the system")
  })
})

describe("the themes to pick", () => {
  const names = (rows: ReturnType<typeof themeRows>) =>
    rows.map((row) => [row.title, row.about, row.current])
  const now = { theme: "night", mode: "system" as const, both: true }

  test("a theme of both, listed by its schemes, is one theme by its name; Banda's own are not listed again", () => {
    const listed: Listed[] = [
      { name: "banda-light", mode: "light", origin: "banda" },
      { name: "banda-dark", mode: "dark", origin: "banda" },
      { name: "macos-light", mode: "light", origin: "banda" },
      { name: "macos-dark", mode: "dark", origin: "banda" },
      {
        name: "night-light",
        mode: "light",
        origin: "yours",
        folder: "/c/themes/night",
      },
      {
        name: "night-dark",
        mode: "dark",
        origin: "yours",
        folder: "/c/themes/night",
      },
    ]
    expect(names(themeRows(now, listed))).toEqual([
      ["This device's", "the default", false],
      ["Banda", "light and dark", false],
      ["Banda macOS", "the Mac's, light and dark", false],
      ["night", "light and dark", true],
    ])
    expect(themeRows(now, listed).at(-1)).toMatchObject({
      key: "theme",
      value: "night",
    })
  })

  test("two folders of one scheme each, named as halves, stay two", () => {
    const listed: Listed[] = [
      {
        name: "dusk-light",
        mode: "light",
        origin: "yours",
        folder: "/c/themes/dusk-light",
      },
      {
        name: "dusk-dark",
        mode: "dark",
        origin: "yours",
        folder: "/c/themes/dusk-dark",
      },
    ]
    expect(names(themeRows(now, listed)).slice(3)).toEqual([
      ["dusk-light", "light", false],
      ["dusk-dark", "dark", false],
    ])
  })

  test('this device\'s comes first, ticked while look.toml names no theme of its own, and says which it takes; a pick of it writes "platform"', () => {
    const device = {
      theme: "platform",
      label: "Banda",
      mode: "system" as const,
      both: true,
    }
    const rows = themeRows(device, [])
    expect(names(rows)).toEqual([
      ["This device's", "the default, Banda here", true],
      ["Banda", "light and dark", false],
      ["Banda macOS", "the Mac's, light and dark", false],
    ])
    expect(rows[0]).toMatchObject({ key: "theme", value: "platform" })
    const write = vi.fn(() => Promise.resolve([]))
    writeLook(write, rows[0]!)
    expect(write).toHaveBeenCalledWith("look.toml", "theme", '"platform"')
  })
})

test("a row writes its key of look.toml in TOML, and what was refused goes to the console", async () => {
  const write = vi.fn(() => Promise.resolve(["no such theme"]))
  const said = vi.spyOn(console, "error").mockImplementation(() => {})
  writeLook(write, {
    kind: "look",
    id: "look.mode.dark",
    key: "mode",
    value: "dark",
    title: "Dark",
    current: false,
  })
  expect(write).toHaveBeenCalledWith("look.toml", "mode", '"dark"')
  await vi.waitFor(() =>
    expect(said).toHaveBeenCalledWith("banda: look.toml refused", [
      "no such theme",
    ])
  )
  said.mockRestore()
})
