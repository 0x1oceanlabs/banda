import { expect, test } from "vitest"
import { onThisMachineOn } from "./machine"

test("on Windows a path is on this machine on a drive only, never a share, a device or a stream", () => {
  const windows = onThisMachineOn("win32")
  for (const path of [
    "C:\\Users\\Ro\\notes.md",
    "c:/Users/Ro/notes.md",
    "D:\\",
  ])
    expect(windows(path), path).toBe(true)
  for (const path of [
    "\\\\attacker\\share\\x.png",
    "//attacker/share/x.png",
    "\\\\?\\C:\\x.exe",
    "\\\\?\\UNC\\attacker\\share\\x",
    "\\\\.\\pipe\\banda",
    "\\??\\UNC\\attacker\\share\\x",
    "\\Users\\Ro\\notes.md",
    "C:notes.md",
    "notes.md",
    "C:\\x\\run.bat::$DATA",
    "C:\\x\\notes.md:hidden",
    "C:\\x\0.png",
  ])
    expect(windows(path), path).toBe(false)
})

test("elsewhere a path is on this machine from the root, never from //", () => {
  expect(onThisMachineOn("linux")("/home/ro/notes.md")).toBe(true)
  expect(onThisMachineOn("darwin")("/Users/ro/a:b.md")).toBe(true)
  for (const path of ["//server/x", "notes.md", "~/notes.md", "/x\0"])
    expect(onThisMachineOn("linux")(path), path).toBe(false)
})
