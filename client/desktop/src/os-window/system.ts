/**
 * What the system says of itself that the theme takes, written where the
 * look reads it: `device.json` in Banda's state folder (ADR 0100,
 * decision 1). Its accent, so the macos theme's focus, rings and buttons
 * take the Person's colour (ADR 0075, decision 6); and whether it reduces
 * transparency or raises contrast, which turns glass off while it does
 * (ADR 0100, decision 4). Written as main starts, and again each time the
 * Person changes one in the system's settings.
 *
 * A part of the device's window (ADR 0089, decision 9): nothing asks it
 * anything, so it is a layer with no service, as the road's is (road.ts).
 */
import type { Device } from "@banda/contract/look"
import { writeWhole } from "@banda/desktop-kit"
import { Effect, FiberSet, Layer } from "effect"
import { nativeTheme, systemPreferences } from "electron"

/** The system, as this part reads it: Electron's in main (`thisSystem`),
 * a fake in a test. */
export type System = {
  /** What it says of itself now. */
  readonly says: () => Device
  /** Calls `changed` each time it may say something else; returns how to
   * stop. */
  readonly listen: (changed: () => void) => () => void
}

/** The accent set in the system's settings, as `#rrggbb` (ADR 0075,
 * decision 6): macOS's and Windows' only. */
function accentOf(platform: NodeJS.Platform): string | null {
  if (platform !== "darwin" && platform !== "win32") return null
  const rgba = systemPreferences.getAccentColor()
  return /^[0-9a-f]{6}/i.test(rgba)
    ? `#${rgba.slice(0, 6).toLowerCase()}`
    : null
}

/** The system Electron runs on. */
export const thisSystem = (platform = process.platform): System => ({
  says: () => {
    const accent = accentOf(platform)
    return {
      ...(accent && { accent }),
      reduce_transparency: nativeTheme.prefersReducedTransparency,
      // Windows' high contrast forces its own colours.
      high_contrast:
        nativeTheme.shouldUseHighContrastColors ||
        nativeTheme.inForcedColorsMode,
    }
  },
  listen: (changed) => {
    // The window's own mode changes `nativeTheme` too.
    nativeTheme.on("updated", changed)
    const stops: Array<() => void> = [
      () => nativeTheme.removeListener("updated", changed),
    ]
    if (platform === "darwin") {
      const accent = systemPreferences.subscribeNotification(
        "AppleColorPreferencesChangedNotification",
        changed
      )
      // Reduce transparency and increase contrast, in Accessibility.
      const display = systemPreferences.subscribeWorkspaceNotification(
        "NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification",
        changed
      )
      stops.push(
        () => systemPreferences.unsubscribeNotification(accent),
        () => systemPreferences.unsubscribeWorkspaceNotification(display)
      )
    } else if (platform === "win32") {
      systemPreferences.on("accent-color-changed", changed)
      stops.push(() =>
        systemPreferences.removeListener("accent-color-changed", changed)
      )
    }
    return () => {
      for (const stop of stops) stop()
    }
  },
})

/**
 * Writes what `system` says to `file`, whole, as the layer is built and
 * on each change, until its scope closes. The look resolves the theme
 * again each time the file changes, so only a change is written. A layer
 * provided with this one starts after the first write: the look's, so
 * the first look has it too (main.ts). A file that cannot be written is
 * said on stderr, and tried again on the next change.
 */
export const systemLayer = (file: string, system: System) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const run = yield* FiberSet.makeRuntime()
      let written = ""
      const write = Effect.sync(() => {
        const text = JSON.stringify(system.says())
        if (text === written) return
        try {
          writeWhole(file, text)
          written = text
        } catch (error) {
          console.error(`banda: ${file}: ${String(error)}`)
        }
      })
      yield* write
      yield* Effect.acquireRelease(
        Effect.sync(() => system.listen(() => void run(write))),
        (stop) => Effect.sync(stop)
      )
    })
  )
