import { describe, expect, it } from "vitest"
import { entryText, shortcutOf } from "./entry"

const PACKED = `[Desktop Entry]
Name=Banda Dev
Exec=AppRun %U
Icon=banda-dev
StartupWMClass=banda-dev
`

describe("an AppImage's entry", () => {
  it("is the packed one, starting the file where it is, quoted", () => {
    const text = entryText(PACKED, '/home/a "b"/$x.AppImage')
    expect(text).toBe(`[Desktop Entry]
Name=Banda Dev
Exec="/home/a \\"b\\"/\\$x.AppImage" %U
TryExec=/home/a "b"/$x.AppImage
Icon=banda-dev
StartupWMClass=banda-dev
`)
  })
})

describe("Banda Local's shortcut on Windows", () => {
  it("is in the Start menu, starts this Electron on the checkout's window, and carries the app ID", () => {
    const { path, link } = shortcutOf(
      "C:\\Users\\Ro\\AppData\\Roaming",
      "C:\\src\\banda\\node_modules\\electron\\dist\\electron.exe",
      "C:\\src\\banda\\client\\desktop"
    )
    expect(path).toBe(
      "C:\\Users\\Ro\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Banda Local.lnk"
    )
    expect(link).toMatchObject({
      target: "C:\\src\\banda\\node_modules\\electron\\dist\\electron.exe",
      args: '"C:\\src\\banda\\client\\desktop"',
      appUserModelId: "so.banda.local",
    })
  })
})
