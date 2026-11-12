/**
 * Files' fonts (ADR 0073, decision 6): a TrueType, OpenType, WOFF or
 * WOFF2 font as a specimen. Its name, family and style come from its own
 * tables; its words show at several sizes in it, as typed in the field
 * or a pangram; and the characters it draws in a grid. The font's bytes
 * come from the file host and load through the FontFace API, for this
 * view only.
 */
import { useEffect, useMemo, useState } from "react"
import { InputGroup, InputGroupInput } from "@banda/ui/components/input-group"
import type { PreviewProps } from "@banda/ui/module"
import { FileWarningIcon } from "lucide-react"
import { Card, Loading } from "../Facts"
import { factsOf, type FontFacts } from "../font"
import { useWhole } from "./whole"

/** The sizes its words show at, in px. */
const SIZES = [12, 16, 24, 36, 48, 72]
const PANGRAM = "The quick brown fox jumps over the lazy dog 0123456789"
const CYRILLIC = "Съешь же ещё этих мягких французских булок"
/** The most characters drawn in the grid. */
const MOST_GLYPHS = 1200

/** Whether a character shows as a mark: not a space or a control. */
const printable = (char: number) =>
  char > 0x20 && !(char >= 0x7f && char <= 0xa0)

/** A name for each font loaded, as no two may share one. */
let loaded = 0

/** The font in `bytes`, loaded for the page under a name of its own: the
 * name once it is, why not when it cannot be. */
function useFace(
  bytes: Uint8Array | null
): { bytes: Uint8Array; family?: string; broken?: string } | null {
  const [face, setFace] = useState<{
    bytes: Uint8Array
    family?: string
    broken?: string
  } | null>(null)
  useEffect(() => {
    if (!bytes) return
    const family = `banda-font-${++loaded}`
    // The file host's bytes are of a buffer of their own.
    const font = new FontFace(family, bytes as Uint8Array<ArrayBuffer>)
    let gone = false
    font.load().then(
      () => {
        if (gone) return
        document.fonts.add(font)
        setFace({ bytes, family })
      },
      (error: unknown) =>
        gone || setFace({ bytes, broken: (error as Error).message })
    )
    return () => {
      gone = true
      document.fonts.delete(font)
    }
  }, [bytes])
  return face
}

/** What the font in `bytes` says of itself, once it is read. */
function useFacts(bytes: Uint8Array | null): FontFacts | null {
  const [facts, setFacts] = useState<{
    bytes: Uint8Array
    facts: FontFacts
  } | null>(null)
  useEffect(() => {
    if (!bytes) return
    let gone = false
    void factsOf(bytes).then((facts) => gone || setFacts({ bytes, facts }))
    return () => {
      gone = true
    }
  }, [bytes])
  return facts?.bytes === bytes ? facts.facts : null
}

export default function FontView(props: PreviewProps) {
  const { file } = props
  const whole = useWhole(props)
  const bytes = whole && "answer" in whole ? whole.answer.bytes : null
  const face = useFace(bytes)
  const facts = useFacts(bytes)
  const [words, setWords] = useState("")
  const chars = facts?.chars
  // Words it draws: a pangram where it has Latin, its own characters
  // where it has none.
  const samples = useMemo(() => {
    if (!chars?.length) return [PANGRAM]
    const has = new Set(chars)
    const latin = has.has(0x61) && has.has(0x7a)
    const own = chars.filter(printable).slice(0, 48)
    return [
      latin ? PANGRAM : String.fromCodePoint(...own),
      ...(has.has(0x436) ? [CYRILLIC] : []),
    ]
  }, [chars])

  if (whole && "refused" in whole)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This font cannot be read"
        note={whole.refused}
      />
    )
  if (face?.broken !== undefined && face.bytes === bytes)
    return (
      <Card
        icon={<FileWarningIcon />}
        title="This font cannot be drawn"
        note={face.broken}
      />
    )
  if (!face?.family || face.bytes !== bytes || !facts) return <Loading />
  const family = `"${face.family}", var(--font-sans)`
  const name = facts.family ?? file.name
  const glyphs = facts.chars.filter(printable)
  // Past those listed, and those the grid has no room for.
  const more =
    facts.charCount -
    facts.chars.length +
    Math.max(0, glyphs.length - MOST_GLYPHS)
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-5">
        <header className="flex flex-col gap-1">
          <h2
            className="truncate text-[2.25rem] leading-tight"
            style={{ fontFamily: family }}
          >
            {name}
          </h2>
          <p className="text-meta text-muted-foreground">
            {facts.family === null &&
              (/\.woff2$/i.test(file.name)
                ? "Its names and characters are packed with Brotli, which this window cannot unpack yet. "
                : "It names itself nowhere Files reads. ")}
            {[
              facts.style,
              facts.full !== name ? facts.full : null,
              facts.glyphs === null
                ? null
                : `${facts.glyphs.toLocaleString("en")} glyphs`,
              facts.charCount
                ? `${facts.charCount.toLocaleString("en")} characters`
                : null,
              facts.version,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>
        <InputGroup className="max-w-md">
          <InputGroupInput
            value={words}
            onChange={(event) => setWords(event.target.value)}
            placeholder="Type to try it"
            aria-label="Words to try"
          />
        </InputGroup>
        <section aria-label="Sizes" className="flex flex-col gap-3">
          {SIZES.map((size) => (
            <div key={size} className="flex items-baseline gap-4">
              <span className="w-8 shrink-0 text-right text-meta text-muted-foreground tabular-nums">
                {size}
              </span>
              <p
                className="min-w-0 truncate leading-tight"
                style={{ fontFamily: family, fontSize: size }}
              >
                {words || samples[0]}
              </p>
            </div>
          ))}
          {!words &&
            samples.slice(1).map((sample) => (
              <p
                key={sample}
                className="truncate pl-12 text-[1.5rem] leading-tight"
                style={{ fontFamily: family }}
              >
                {sample}
              </p>
            ))}
        </section>
        {glyphs.length > 0 && (
          <section aria-label="Characters" className="flex flex-col gap-2">
            <h3 className="text-meta font-medium text-muted-foreground">
              Characters
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-px overflow-hidden rounded-card bg-border">
              {glyphs.slice(0, MOST_GLYPHS).map((char) => {
                const code = `U+${char.toString(16).toUpperCase().padStart(4, "0")}`
                return (
                  <div
                    key={char}
                    title={code}
                    className="flex aspect-square flex-col items-center justify-center bg-background"
                  >
                    <span
                      className="text-[1.5rem] leading-none"
                      style={{ fontFamily: family }}
                    >
                      {String.fromCodePoint(char)}
                    </span>
                    <span className="mt-1 text-meta text-muted-foreground tabular-nums">
                      {code}
                    </span>
                  </div>
                )
              })}
            </div>
            {more > 0 && (
              <p className="text-meta text-muted-foreground">
                And {more.toLocaleString("en")} more.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
