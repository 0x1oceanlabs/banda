/**
 * What the Person chose for Banda's sounds: `[sound]` in `look.toml`
 * (ADR 0009, decision 5). Until the look sends them, the defaults hold.
 */
import { type Chime, type Family, LEVELS } from "./families"

export type SoundSettings = {
  /** The family every call comes from, or `off` for silence. */
  family: Family | "off"
  /** 0 to 1, for every sound. */
  volume: number
  /** A soft room around each sound. */
  room: boolean
  /** Each call: on, off, or a family to borrow this one sound from. */
  done: boolean | Family
  asking: boolean | Family
  failed: boolean | Family
}

export const DEFAULT_SOUND: SoundSettings = {
  family: "banda",
  volume: 0.6,
  room: true,
  done: true,
  asking: true,
  failed: true,
}

/** How one call sounds: its family, and its gain with the volume in it. */
export type Voicing = { family: Family; gain: number }

/** How `chime` sounds with `settings`; nothing when it is silent. */
export function voicing(
  chime: Chime,
  settings: SoundSettings
): Voicing | undefined {
  const own = settings[chime]
  if (settings.family === "off" || own === false) return undefined
  const family = own === true ? settings.family : own
  const volume = Math.min(1, Math.max(0, settings.volume))
  if (volume === 0) return undefined
  return { family, gain: volume * Math.pow(10, LEVELS[family][chime] / 20) }
}
