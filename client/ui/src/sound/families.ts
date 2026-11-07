/**
 * Banda's families of sounds (ADR 0009, decision 1): each plays the three
 * calls, done, asking and failed, its own way. `banda` is the default.
 */
import { glass, pluck, pop, type Voice, wood } from "./instruments"

/** What calls for the Person, as the Mark shows it. */
export type Chime = "done" | "asking" | "failed"

export const CHIMES: readonly Chime[] = ["done", "asking", "failed"]

export type Family = "banda" | "glass" | "wood" | "pop" | "pluck"

export const FAMILIES: readonly Family[] = [
  "banda",
  "glass",
  "wood",
  "pop",
  "pluck",
]

/** Plays one call into a voice, from `at`. */
type Recipe = (voice: Voice, at: number) => void

const NOTE = {
  A3: 220,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  G4: 392,
  A4: 440,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  G5: 784,
  B5: 987.8,
  C6: 1046.5,
  D6: 1174.7,
  E6: 1318.5,
}

/**
 * Each family's calls. Done rises, asking lifts like a question, failed
 * falls; none lasts more than half a second before its room.
 */
export const RECIPES: Record<Family, Record<Chime, Recipe>> = {
  // The hat hops with a pop and lands with a small bell.
  banda: {
    done: (v, t) => {
      pop(v, t, NOTE.E5, 0.8)
      glass(v, t + 0.13, NOTE.B5, 0.8)
    },
    asking: (v, t) => {
      pop(v, t, NOTE.G5, 0.9)
      pop(v, t + 0.16, NOTE.D6, 0.9, { to: NOTE.E6 * 1.04, decay: 0.22 })
      glass(v, t + 0.17, NOTE.D6, 0.35)
    },
    failed: (v, t) => {
      pop(v, t, NOTE.A4, 0.8, { from: 1.25, glide: 0.06, decay: 0.2 })
      wood(v, t + 0.15, NOTE.E4, 0.8)
    },
  },
  glass: {
    done: (v, t) => {
      glass(v, t, NOTE.E5)
      glass(v, t + 0.09, NOTE.B5)
    },
    asking: (v, t) => {
      glass(v, t, NOTE.C6)
      glass(v, t + 0.12, NOTE.E6)
      glass(v, t + 0.3, NOTE.C6, 0.45)
    },
    failed: (v, t) => {
      glass(v, t, NOTE.A4, 0.8)
      glass(v, t + 0.14, NOTE.E4, 0.8)
    },
  },
  // Asking knocks twice, as at a door.
  wood: {
    done: (v, t) => {
      wood(v, t, NOTE.C5)
      wood(v, t + 0.07, NOTE.E5)
      wood(v, t + 0.14, NOTE.G5)
    },
    asking: (v, t) => {
      wood(v, t, NOTE.G5)
      wood(v, t + 0.13, NOTE.G5)
      wood(v, t + 0.26, NOTE.D6, 0.8)
    },
    failed: (v, t) => {
      wood(v, t, NOTE.D4)
      wood(v, t + 0.15, NOTE.A3)
    },
  },
  pop: {
    done: (v, t) => {
      pop(v, t, NOTE.E5)
      pop(v, t + 0.1, NOTE.B5)
    },
    asking: (v, t) => {
      pop(v, t, NOTE.G5)
      pop(v, t + 0.15, NOTE.C6, 1, { to: NOTE.E6, decay: 0.24 })
    },
    failed: (v, t) =>
      pop(v, t, NOTE.A4, 1, {
        from: 1.3,
        glide: 0.03,
        decay: 0.32,
        to: NOTE.A3,
      }),
  },
  pluck: {
    done: (v, t) => {
      pluck(v, t, NOTE.G4)
      pluck(v, t + 0.05, NOTE.D5)
      pluck(v, t + 0.1, NOTE.G5, 0.8)
    },
    asking: (v, t) => {
      pluck(v, t, NOTE.B4)
      pluck(v, t + 0.14, NOTE.E5)
      pluck(v, t + 0.28, NOTE.B5, 0.7)
    },
    failed: (v, t) => {
      pluck(v, t, NOTE.E4, 1, 0.6)
      pluck(v, t + 0.16, NOTE.C4, 1, 0.7)
    },
  },
}

/**
 * Each sound's gain in dB, measured so every family keeps one ladder of
 * loudness (ADR 0009, decision 2): done about −26 LUFS, asking −23,
 * failed −24, at volume 0.8 and with the room.
 */
export const LEVELS: Record<Family, Record<Chime, number>> = {
  banda: { done: -0.3, asking: 4.3, failed: 2.6 },
  glass: { done: -3.5, asking: -1.3, failed: 1.2 },
  wood: { done: -3.5, asking: -1, failed: 0.4 },
  pop: { done: 1.4, asking: 3.4, failed: 9.2 },
  pluck: { done: -1, asking: 1.6, failed: -1.3 },
}
