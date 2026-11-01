/**
 * The instruments Banda's sounds are played on (ADR 0009, decision 1):
 * a few oscillators and a string, shaped by envelopes. Each plays one note
 * into a voice's output at a given time.
 */

/** Where a note goes: the context, and the output of the voice that plays it. */
export type Voice = { ctx: BaseAudioContext; out: AudioNode }

/** A gain that rises to `peak` in `attack`, then falls away over `decay`. */
function envelope(
  { ctx }: Voice,
  at: number,
  peak: number,
  attack: number,
  decay: number
): GainNode {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(1e-4, at + attack + decay)
  return gain
}

/** One sine, or another plain wave, with its envelope. */
function tone(
  voice: Voice,
  at: number,
  frequency: number,
  peak: number,
  attack: number,
  decay: number,
  type: OscillatorType = "sine"
) {
  const oscillator = voice.ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  const gain = envelope(voice, at, peak, attack, decay)
  oscillator.connect(gain).connect(voice.out)
  oscillator.start(at)
  oscillator.stop(at + attack + decay + 0.05)
}

/** A small bell: its partials a little apart, the high ones ringing less. */
export function glass(voice: Voice, at: number, frequency: number, level = 1) {
  const partials = [
    [1, 1, 1.1],
    [2.01, 0.32, 0.55],
    [3.02, 0.14, 0.3],
    [4.16, 0.06, 0.18],
  ]
  for (const [ratio, amount, decay] of partials)
    tone(voice, at, frequency * ratio, 0.22 * level * amount, 0.004, decay)
}

/** A marimba bar: its fourth partial is the quick knock of the mallet. */
export function wood(voice: Voice, at: number, frequency: number, level = 1) {
  tone(voice, at, frequency, 0.3 * level, 0.003, 0.42)
  tone(voice, at, frequency * 3.93, 0.12 * level, 0.002, 0.05)
  tone(voice, at, frequency * 9.2, 0.03 * level, 0.001, 0.015)
}

export type PopShape = {
  /** Where the pitch starts, as a part of `frequency`. */
  from?: number
  /** How long it takes to reach `frequency`. */
  glide?: number
  decay?: number
  /** Where the pitch goes after, if it moves on. */
  to?: number
}

/** A bubble, the hat's hop: its pitch springs to the note as it starts. */
export function pop(
  voice: Voice,
  at: number,
  frequency: number,
  level = 1,
  { from = 0.62, glide = 0.045, decay = 0.16, to }: PopShape = {}
) {
  const oscillator = voice.ctx.createOscillator()
  oscillator.frequency.setValueAtTime(frequency * from, at)
  oscillator.frequency.exponentialRampToValueAtTime(frequency, at + glide)
  if (to)
    oscillator.frequency.exponentialRampToValueAtTime(to, at + decay * 0.9)
  const gain = envelope(voice, at, 0.32 * level, 0.004, decay)
  oscillator.connect(gain).connect(voice.out)
  oscillator.start(at)
  oscillator.stop(at + decay + 0.05)
  tone(voice, at, frequency * 2, 0.05 * level, 0.003, decay * 0.5, "triangle")
}

/**
 * A plucked string, as Karplus and Strong made one: a burst of noise that
 * a delay keeps averaging. The noise has a fixed seed, so a string sounds
 * the same every time; it fades at the end rather than stopping short.
 */
export function pluck(
  voice: Voice,
  at: number,
  frequency: number,
  level = 1,
  length = 0.9
) {
  const { ctx } = voice
  const rate = ctx.sampleRate
  const size = Math.floor(rate * length)
  const buffer = ctx.createBuffer(1, size, rate)
  const data = buffer.getChannelData(0)
  const period = Math.round(rate / frequency)
  const random = seeded(Math.round(frequency * 1000))
  for (let i = 0; i < period; i++) data[i] = random() * 2 - 1
  for (let i = period; i < size; i++)
    data[i] = 0.996 * 0.5 * (data[i - period] + data[i - period + 1])
  const fade = Math.floor(rate * 0.06)
  for (let i = 0; i < fade; i++) data[size - 1 - i] *= i / fade

  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.value = 0.38 * level
  const soft = ctx.createBiquadFilter()
  soft.type = "lowpass"
  soft.frequency.value = 3200
  source.connect(gain).connect(soft).connect(voice.out)
  source.start(at)
}

/**
 * A soft room: a second and a bit of noise that dies away, as the impulse a
 * convolver answers with. Seeded, so the room is the same every time.
 */
export function room(ctx: BaseAudioContext, seconds = 1.3): AudioBuffer {
  const size = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, size, ctx.sampleRate)
  const random = seeded(7)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < size; i++)
      data[i] = (random() * 2 - 1) * Math.pow(1 - i / size, 3.2)
  }
  return buffer
}

/** Numbers from 0 to 1 that start from `seed`: mulberry32. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = Math.imul(state ^ (state >>> 15), state | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
