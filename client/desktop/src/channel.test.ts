import { readFileSync } from "node:fs"
import { resolve, win32 } from "node:path"
import { expect, test } from "vitest"
import { folderOf, type System } from "./channel"

/** Where the engine keeps its places on Windows, which its own test reads
 * too (engine/src/places/windows.rs, ADR 0090, step 3): Banda's `folder`
 * in the `local` app data, a folder of each place in it, none in Roaming. */
const WINDOWS: {
  local: string
  folder: string
  places: Record<"data" | "state" | "config" | "cache", string>
} = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../engine/tests/windows-places.json"),
    "utf8"
  )
)

const on = (
  platform: NodeJS.Platform,
  env: Record<string, string> = {}
): System => ({
  platform,
  env,
  // The profile that holds the local app data, as Windows keeps it.
  home:
    platform === "win32" ? win32.resolve(WINDOWS.local, "../..") : "/home/ro",
  appData: "/Users/ro/Library/Application Support",
})

test("on Windows the window keeps its state and data, and reads its config, where the engine does", () => {
  const local = { LOCALAPPDATA: WINDOWS.local }
  for (const name of ["state", "data", "config"] as const) {
    expect(folderOf(name, on("win32", local), WINDOWS.folder)).toBe(
      WINDOWS.places[name]
    )
    // With no LOCALAPPDATA, where Windows keeps it in the profile.
    expect(folderOf(name, on("win32"), WINDOWS.folder)).toBe(
      WINDOWS.places[name]
    )
  }
})

test("elsewhere it keeps them in XDG's folders, ~/.local's, or macOS's app data", () => {
  expect(folderOf("state", on("linux"), "banda")).toBe(
    "/home/ro/.local/state/banda"
  )
  expect(folderOf("data", on("linux"), "banda")).toBe(
    "/home/ro/.local/share/banda"
  )
  expect(folderOf("config", on("linux"), "banda")).toBe(
    "/home/ro/.config/banda"
  )
  expect(
    folderOf("config", on("linux", { XDG_CONFIG_HOME: "/x/config" }), "banda")
  ).toBe("/x/config/banda")
  expect(
    folderOf("state", on("linux", { XDG_STATE_HOME: "/x/state" }), "banda")
  ).toBe("/x/state/banda")
  expect(
    folderOf("state", on("linux", { XDG_STATE_HOME: "state" }), "banda")
  ).toBe("/home/ro/.local/state/banda")
  expect(folderOf("data", on("darwin"), "banda")).toBe(
    "/Users/ro/Library/Application Support/banda"
  )
  expect(folderOf("config", on("darwin"), "banda")).toBe(
    "/Users/ro/Library/Application Support/banda"
  )
})

test("a variable moves a place, on any system", () => {
  // On Windows the engine takes one only in the Person's profile.
  const moved = win32.join(on("win32").home, "trial", "state")
  expect(folderOf("state", on("win32", { BANDA_STATE: moved }))).toBe(moved)
  expect(folderOf("data", on("linux", { BANDA_DATA: "/d" }))).toBe("/d")
  expect(folderOf("config", on("linux", { BANDA_CONFIG: "/c" }))).toBe("/c")
})
