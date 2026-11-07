import { describe, expect, it } from "vitest"
import { entryText } from "./entry"

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
