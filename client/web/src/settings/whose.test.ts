/**
 * Whose copy a settings file is, in the line under its rows (ADR 0101,
 * decision 3; #1736, point 4): the words by class and by the machine
 * shown, the files a section says it for, and the path as it is drawn.
 */
import { fileClass, rowsOf } from "@banda/contract/settings"
import { expect, test } from "vitest"
import { groupsOf, parseLink } from "./sections"
import { filesOf, inFolder, marksOf, partsOf, tilde, whoseWords } from "./whose"

test("the line says every device for a shared file, this device for the device's, and the machine's name for a machine's", () => {
  expect(whoseWords(fileClass("tiling.toml"))).toBe("on every device")
  expect(whoseWords(fileClass("sidebar.toml"))).toBe("on every device")
  expect(whoseWords(fileClass("look.toml"))).toBe("on this device")
  expect(whoseWords(fileClass("terminal.toml"))).toBe("on this device")
  expect(whoseWords(fileClass("harnesses.toml"), "arc")).toBe("on arc")
  // A file no schema knows is the device's, as in doubt.
  expect(fileClass("nothing.toml")).toBe("device")
})

test("with another machine picked, a machine's file is that machine's, and the rest say what they said", () => {
  expect(whoseWords(fileClass("harnesses.toml"), "studio")).toBe("on studio")
  expect(whoseWords(fileClass("browser.toml"), "studio")).toBe("on this device")
  expect(whoseWords(fileClass("tiling.toml"), "studio")).toBe("on every device")
  // Until a machine's engine said its name, it is this computer.
  expect(whoseWords("machine")).toMatch(/^on this (Mac|machine)$/)
})

test("a file of two classes says its own, and each top-level key that differs its own", () => {
  expect(fileClass("browser.toml")).toBe("device")
  expect(fileClass("agents.toml")).toBe("device")
  expect(fileClass("keys.toml")).toBe("shared")
  const group = (id: string, title: string) =>
    groupsOf(parseLink(id).section).find((one) => one.title === title)!

  // The Agents' browser is the machine's: said once, at its heading.
  expect(marksOf(group("browser", "Agent tools"))).toEqual({
    heading: "machine",
    rows: new Map(),
  })
  // Notify is shared in the device's look.toml.
  expect(marksOf(group("sounds", "Notify")).heading).toBe("shared")
  expect(marksOf(group("sounds", "Sound"))).toEqual({ rows: new Map() })
  // A group of rows of two classes says it at the rows that differ.
  expect(marksOf(group("agents", "Writing to an Agent"))).toEqual({
    rows: new Map([
      ["enter", "shared"],
      ["models", "machine"],
    ]),
  })
  // A group with no heading says it at its rows.
  const pinned = rowsOf("files.toml").filter((row) => row.key === "pinned")
  expect(marksOf({ title: "", rows: pinned })).toEqual({
    rows: new Map([["pinned", "machine"]]),
  })
})

test("a section says each of its files once, and one that shows every machine or no file says none", () => {
  expect(filesOf(parseLink("tiling").section)).toEqual(["tiling.toml"])
  expect(filesOf(parseLink("appearance").section)).toEqual(["look.toml"])
  expect(filesOf(parseLink("agents").section)).toEqual([
    "harnesses.toml",
    "agents.toml",
  ])
  expect(filesOf(parseLink("general").section)).toEqual([])
  expect(filesOf(parseLink("machines").section)).toEqual([])
  expect(filesOf(parseLink("settings-files").section)).toEqual([])
})

test("a path says home as ~, on any machine, and is cut before its name", () => {
  expect(tilde("/home/ada/.config/banda/tiling.toml")).toBe(
    "~/.config/banda/tiling.toml"
  )
  expect(tilde("/Users/ada/.config/banda/look.toml")).toBe(
    "~/.config/banda/look.toml"
  )
  expect(tilde("C:\\Users\\ada\\AppData\\Roaming\\banda\\look.toml")).toBe(
    "~\\AppData\\Roaming\\banda\\look.toml"
  )
  expect(tilde("/root/.config/banda/look.toml")).toBe(
    "~/.config/banda/look.toml"
  )
  expect(tilde("/homework/x.toml")).toBe("/homework/x.toml")
  expect(tilde("/srv/banda/look.toml")).toBe("/srv/banda/look.toml")

  expect(inFolder("/home/ada/.config/banda", "look.toml")).toBe(
    "/home/ada/.config/banda/look.toml"
  )
  expect(inFolder("C:\\Users\\ada\\banda", "look.toml")).toBe(
    "C:\\Users\\ada\\banda\\look.toml"
  )
  expect(partsOf("~/.config/banda/tiling.toml")).toEqual({
    folders: "~/.config/banda",
    name: "/tiling.toml",
  })
  expect(partsOf("tiling.toml")).toEqual({ folders: "", name: "tiling.toml" })
})
