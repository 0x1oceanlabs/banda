import { expect, test } from "vitest"
import { runs } from "./outside"

const file = (mode: number) => ({ isDirectory: () => false, mode })
const folder = { isDirectory: () => true, mode: 0o40755 }

test("a program or a macOS app could run; a page, a picture or a folder could not", () => {
  expect(runs(file(0o100755), "/usr/bin/git")).toBe(true)
  expect(runs(file(0o100744), "/tmp/run.sh")).toBe(true)
  expect(runs(file(0o100644), "/tmp/notes.txt")).toBe(false)
  expect(runs(folder, "/Applications/Banda.app")).toBe(true)
  expect(runs(folder, "/home/roma/code")).toBe(false)
})

test("on Windows, which marks no file a program, a file of a kind Windows runs could run, however its name is written", () => {
  // Node gives every file of Windows the same mode.
  const windows = (path: string, pathext?: string) =>
    runs(file(0o100666), path, "win32", pathext)
  const PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC"
  for (const path of [
    "C:\\Users\\Ro\\Downloads\\setup.exe",
    "C:\\work\\x.bat",
    "C:\\work\\X.CMD",
    "C:\\work\\build.ps1",
    "C:\\work\\Banda.lnk",
    "C:\\work\\site.url",
    "C:\\work\\screen.scr",
    "C:\\work\\install.msi",
    "C:\\work\\page.hta",
    "C:\\work\\run.vbs",
    "C:\\work\\index.js",
    "C:\\work\\task.wsf",
    "C:\\work\\panel.cpl",
    "C:\\work\\keys.reg",
    "C:\\work\\app.appref-ms",
    "C:\\work\\x.bat.",
    "C:\\work\\x.bat. .",
    "C:/work/x.exe",
    "C:\\work\\.exe",
    "C:\\work\\build.sh",
    "C:\\work\\cache.pyc",
    "C:\\work\\report.xlsm",
    "C:\\work\\root.crt",
  ])
    expect(windows(path, PATHEXT), path).toBe(true)
  // PATHEXT names a kind of the Person's own.
  expect(windows("C:\\work\\tool.lua", `${PATHEXT};.LUA`)).toBe(true)
  expect(windows("C:\\work\\tool.lua", PATHEXT)).toBe(false)
  for (const path of [
    "C:\\work\\notes.txt",
    "C:\\work\\banda.toml",
    "C:\\work\\shot.png",
    "C:\\work\\README",
    "C:\\work\\.exe.txt",
    "C:\\work\\.gitignore",
  ])
    expect(windows(path, PATHEXT), path).toBe(false)
  expect(runs(folder, "C:\\work\\x.exe", "win32")).toBe(false)
})
