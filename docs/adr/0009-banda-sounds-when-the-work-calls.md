---
status: accepted
date: 2026-11-01
---

# Banda sounds when the work calls for its Person

The Mark shows what the work calls the Person for (ADR 0005, decisions 8 and 9): a Thread finished, asks them, or failed. A Person who looks at another window does not see it. Every tool that runs Agents grows a sound for this sooner or later. For Claude Code and Codex, people add it themselves through hooks: a sound when the Agent stops, another when it asks.

On 2026-11-01 Roma asked for sounds when an Agent finishes or needs something, "good ones; these are important details", with the settings in a config file. He listened to five families of sounds made for Banda, `banda`, `glass`, `wood`, `pop` and `pluck`, each with the rules below, and said: "very good, build it, and our settings through the config file".

**Decision.** Roma decided the points marked _decided_. On 2026-11-01 he accepted the rest as our defaults and asked to build; each stays his to change.

1. **Banda's own sounds, made in code** (_decided_).
   - No samples: each sound is a few notes from a few instruments, played with Web Audio. So there are no licences to keep, the sounds weigh nothing, and they belong to Banda as the Mark does.
   - Five families: `banda`, the default (the hat hops with a pop and lands with a small bell), `glass`, `wood`, `pop` and `pluck`.
   - A sound is the same every time: the noise a string or the room starts from has a fixed seed.

2. **Three calls, on a ladder of loudness.**
   - `done`: a Thread finished while the Person was away. The softest, about −26 LUFS, and it rises.
   - `asking`: a Question waits. The clearest, about −23 LUFS.
   - `failed`: a turn failed or was cut short. Low, short and falling, about −24 LUFS.
   - A turn that starts or works makes no sound. A sound lasts under half a second, and the room after it fades.
   - Every family keeps the same ladder, so changing the family never makes one call louder than another.

3. **When a sound plays.**
   - Only when a Thread's Mark changes now: nothing at startup or on a fresh read of what already was.
   - Not for the Thread the Person is looking at: its Pane has the focus and the window is in front. They see it already, as they see a turn end (ADR 0005, decision 8, "seen").
   - Calls that come together, within a tenth of a second, make one sound: the loudest of them, in the Mark's order (failed, then asking, then done).
   - For 1.5 s after a sound, only a louder call plays. So an engine that restarts and fails every running turn is heard once.

4. **A module says what calls; the window plays it.**
   - A module's Watch (`app/ui/src/pane.ts`) reports each call, a Mark state and what it is about, besides the Space's attention.
   - The window merges the calls and plays them. It knows nothing of Threads, and the next module calls the same way.
   - The sounds live in `app/ui/src/sound/`, beside the Mark, which they move with.

5. **The settings are the look's: `[sound]` in `look.toml`** (_decided_: "our settings through the config file").
   - Sound is the look's other half, as motion is (ADR 0005, decision 16): the pop goes with the hat's hop. So it is layered as the look is (ADR 0007, decision 2): Banda's defaults, then a theme's `banda.toml`, then the Person's `~/.config/banda/look.toml`. A theme can bring its own sounds.
   - `banda look` resolves and checks it, and `--follow` sends each change, as for every other key of the look. A wrong value is named in the notice: a volume out of 0 to 1 keeps the default and the rest applies; a family that does not exist is named with its line and the ones that do, and the file is left out as any file TOML cannot read is (ADR 0007).
   - The keys, with their defaults:

     ```toml
     [sound]
     family = "banda"   # "banda", "glass", "wood", "pop", "pluck", or "off" for silence
     volume = 0.6       # 0 to 1, for every sound
     room = true        # a soft room around each sound
     done = true        # true, false, or a family to borrow this one sound from
     asking = true
     failed = true
     ```

   - Until the look's program sends them, the window plays with these defaults.

**Consequences.**

- Electron lets the page play sound before the Person first clicks in it, so a Thread that finishes right after startup is heard.
- The order of work, each step its own PR:
  1. **The sounds and their rules**, with the defaults.
  2. **`[sound]` in `look.toml`**, once the look's program is in (ADR 0007, steps 2 and 3).
- Later: a system notification with the sound when the window is not in front (ADR 0005, decision 8), from the same calls; a Person's own sound files; a quiet time.
