/**
 * Plays Banda's sounds in the window: one audio context, made on the first
 * sound, a gentle limiter, and a soft room each sound may go through.
 */
import { RECIPES, type Chime } from "./families"
import { room } from "./instruments"
import { type SoundSettings, voicing } from "./settings"

/** How much of the room each sound gets. */
const ROOM = 0.16

class Player {
  private ctx?: AudioContext
  private dry?: AudioNode
  private wet?: AudioNode

  /** Plays `chime` as `settings` say; nothing when they silence it. */
  play(chime: Chime, settings: SoundSettings) {
    const voiced = voicing(chime, settings)
    if (!voiced) return
    const ctx = this.context()
    if (!ctx || !this.dry || !this.wet) return
    if (ctx.state === "suspended") void ctx.resume()
    const bus = ctx.createGain()
    bus.gain.value = voiced.gain
    bus.connect(this.dry)
    if (settings.room) bus.connect(this.wet)
    RECIPES[voiced.family][chime]({ ctx, out: bus }, ctx.currentTime + 0.03)
  }

  private context(): AudioContext | undefined {
    if (this.ctx) return this.ctx
    if (typeof AudioContext === "undefined") return undefined
    const ctx = new AudioContext()
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -18
    limiter.ratio.value = 3
    limiter.connect(ctx.destination)
    const dry = ctx.createGain()
    dry.connect(limiter)
    const wet = ctx.createGain()
    wet.gain.value = ROOM
    const reverb = ctx.createConvolver()
    reverb.buffer = room(ctx)
    wet.connect(reverb).connect(limiter)
    Object.assign(this, { ctx, dry, wet })
    return ctx
  }
}

/** The window's one player. */
export const player = new Player()
