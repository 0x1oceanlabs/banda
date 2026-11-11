/**
 * Banda UI's check (ADR 0113, decision 9): what in a source file or a
 * stylesheet draws with other than Banda UI, the theme's tokens and the
 * names `@banda/ui` makes on them. Each case comes with its kind, the rule
 * of the guidelines' §5 it breaks, and what to write instead:
 *
 * | Kind | Rule | Found |
 * |---|---|---|
 * | colour | `design.4` | hex, `rgb()`, `oklch()` and the other colour functions, a named or system colour, a Tailwind palette class (`bg-white`, `text-amber-500`) |
 * | corner | `design.9` | a corner on no level (ADR 0080, decision 6) |
 * | type | `design.10` | a size as a number (`text-[11px]`, `text-(length:--x)`, `font-size: 12px`, `fontSize: 14`), a line height in a class's brackets, a Tailwind size name but `text-xs` and `text-sm` |
 * | shadow | `design.11` | Tailwind's sizes (`shadow-md`, `drop-shadow-sm`), a shadow drawn by hand, `box-shadow`, `text-shadow`, `drop-shadow()` |
 * | layer | `design.12` | `z-10`, `z-[100]`, `z-index: 4`, `zIndex: 1` |
 * | length | `design.13` | a length in a spacing or size class's brackets off the 4 px grid: `pb-[5px]`, `gap-[7px]` |
 *
 * Banda UI's names are read where they are made: the corner levels from
 * the theme's tokens, the type levels and the layers from `@banda/ui`'s
 * `@theme`. Allowed by rule, so never a case: a custom property defined
 * in `@banda/ui`'s stylesheets (`makesNames`), as `--tile-shadow` is;
 * tokens mixed (`color-mix()` over `var(--…)` and `transparent`), a colour
 * worked out from a token (`oklch(from var(--…) …)`) or from data
 * (`rgb(${…})`); a ring, an inset line with no blur in a token's colour; a
 * shadow, a layer or a size by a custom property's name; `z-index` 0, -1
 * and `auto`. Tailwind's `text-xs` and `text-sm` stay allowed until ADR
 * 0113's step 1b renames them. A line height in a stylesheet goes with its
 * size, and is not counted apart.
 *
 * Comments are no place. A shadow drawn by hand is one case, the colours
 * in it with it.
 */
/// <reference types="node" />
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { TOKENS } from "@banda/contract/look"

/** What a case draws with. */
export type Kind = "colour" | "corner" | "type" | "shadow" | "layer" | "length"

/** The rule of the guidelines' §5 each kind breaks (docs/sdk/guidelines.md). */
export const RULES = {
  colour: "design.4",
  corner: "design.9",
  type: "design.10",
  shadow: "design.11",
  layer: "design.12",
  length: "design.13",
} as const satisfies Record<Kind, string>

export type Rule = (typeof RULES)[Kind]

/** One place off Banda UI. */
export interface Case {
  kind: Kind
  rule: Rule
  /** The class, the declaration or the literal, as the source writes it. */
  what: string
  /** Why it is refused, and what to write instead. */
  instead: string
}

/** `@banda/ui`'s stylesheets, where Banda UI makes its names. */
const STYLES = new URL("../styles/", import.meta.url)

/** Whether `file` is one of `@banda/ui`'s stylesheets, where a custom
 * property defined is a name Banda UI makes, not a case. */
export function makesNames(file: string): boolean {
  return file.startsWith(fileURLToPath(STYLES)) && file.endsWith(".css")
}

/** What `code` says once its comments are taken out. A `/*` in a string
 * on one line, as a glob's, starts none. */
const uncommented = (code: string) =>
  code
    .replace(
      /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\/\*[\s\S]*?\*\//g,
      (_, string: string | undefined) => string ?? ""
    )
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

/** The names `@banda/ui`'s `@theme` makes, each with its value. */
const THEME = (() => {
  const sheet = uncommented(
    readFileSync(new URL("globals.css", STYLES), "utf8")
  )
  const theme = /@theme inline \{([^}]*)\}/.exec(sheet)?.[1]
  if (!theme) throw new Error("globals.css has no @theme inline block")
  return new Map(
    [...theme.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, name, value]) => [name, value.trim()] as const
    )
  )
})()

/** The names `@theme` makes of one namespace (`text`, `z-index`), each
 * with its value; a level's line height, after a second `--`, is no name. */
const named = (namespace: string) =>
  [...THEME].flatMap(([name, value]) => {
    const short = name.slice(namespace.length + 1)
    return name.startsWith(`${namespace}-`) && !short.includes("--")
      ? [[short, value] as const]
      : []
  })

/** Each case in `source`, a TS, TSX or CSS file, in the order of its kinds.
 * `names` says it is one of `@banda/ui`'s stylesheets (`makesNames`). */
export function look(source: string, { names = false } = {}): Case[] {
  let code = uncommented(source)
  if (names) code = code.replace(/(?<![\w-])(--[\w-]+\s*:)[^;{}]*/g, "$1")
  const shadows = shadowsIn(code)
  // What a shadow case takes in is that case's, colours too.
  const free = (at: number) =>
    !shadows.some((shadow) => at >= shadow.at && at < shadow.end)
  return [
    ...coloursIn(code, free).map((what) => found("colour", what)),
    ...corners(code).map((what) => found("corner", what)),
    ...typeIn(code),
    ...shadows.map(({ what }) => found("shadow", what)),
    ...layersIn(code).map((what) => found("layer", what)),
    ...lengthsIn(code).map((what) => found("length", what)),
  ]
}

/** The refusal of `found`, as a test says it: its rule, what, and what to
 * write instead. */
export function refusal({ rule, what, instead }: Case): string {
  return `${rule}: ${what} ${instead}`
}

function found(kind: Kind, what: string, instead = INSTEAD[kind]): Case {
  return { kind, rule: RULES[kind], what, instead }
}

/** `names` as a list of classes, each with its `prefix`. */
const classes = (prefix: string, names: Iterable<string>) =>
  [...names].map((name) => `\`${prefix}${name}\``).join(", ")

/** A length's pixels: a rem is 16 of them. */
const px = (number: string, unit: string) =>
  Number(number) * (unit === "rem" ? 16 : 1)

/** What draws with a custom property's name alone, as a class's brackets
 * or a declaration may say it. */
const byName = (value: string) =>
  /^(?:\(--[\w-]+\)|\[var\(--[\w-]+\)\]|var\(--[\w-]+\))$/.test(value)

/** What a class's prefix may be: variants (`hover:`, `data-[x]:`) end in
 * a colon, so a class starts after one, a space or a quote. */
const START = String.raw`(?<![\w./\[-])`
/** A class's arbitrary value: `[…]` or `(…)`, no space in it. */
const ARBITRARY = String.raw`\[[^\]\s]*\]|\([^)\s]*\)`

// Colours (decision 6).

/** The utilities that take a colour. */
const PAINTS =
  "bg|text|border(?:-[xytblrse])?|ring|ring-offset|inset-ring|fill|stroke|from|via|to|outline|decoration|shadow|inset-shadow|drop-shadow|text-shadow|accent|caret|divide|placeholder"
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
/** CSS's colour spaces, as `color()` names them. */
const SPACES =
  "srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?"

/** CSS's named colours, and the system's (`Canvas`, `AccentColor`). */
const NAMED = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(
    " "
  )
)
const SYSTEM = new Set(
  "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext".split(
    " "
  )
)
/** The named and system colours in a value, by word. */
const namedIn = (value: string) =>
  [...value.matchAll(/(?<![\w.-])[A-Za-z]+(?![\w-(])/g)].filter(
    ([word]) => NAMED.has(word) || SYSTEM.has(word.toLowerCase())
  )

/** The CSS properties that take a colour; a custom property may hold one
 * too. */
const PAINTED = String.raw`--[\w-]+|color|background(?:-color|-image)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|stop-color|flood-color|lighting-color|scrollbar-color|mask(?:-image)?|(?:-webkit-)?text-fill-color|box-shadow|text-shadow`

const PALETTE_CLASS = new RegExp(
  `${START}-?(?:${PAINTS})-(?:black|white|(?:${PALETTE})-\\d{2,3})(?:/(?:[\\w.]+|\\[[^\\]\\s]*\\]))?(?![\\w-])`,
  "g"
)
const HEX =
  /(?<![A-Za-z0-9&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
// A colour function of numbers; one of a token (`from var(--…)`) or of
// data (`${…}`) follows it, as does a function of the same name.
const FUNCTION = new RegExp(
  `(?<![A-Za-z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color(?=\\(\\s*(?:${SPACES})))\\((?=[\\s_]*(?:[\\d.+-]|none\\b|${SPACES}))`,
  "g"
)
const DECLARED = new RegExp(
  `(?<![\\w-])(?:${PAINTED})\\s*:\\s*([^;{}"'\`\\n]+)`,
  "g"
)
const PAINT_BRACKETS = new RegExp(
  `${START}-?(?:${PAINTS})-\\[([^\\]\\s]*)\\]`,
  "g"
)

/** The literal colours in `code`, each where `free` says no shadow case
 * took it: palette classes, hex, colour functions of numbers, and named
 * colours as a whole string, in a declaration's value or in a colour
 * class's brackets. */
function coloursIn(code: string, free: (at: number) => boolean): string[] {
  const found: { at: number; what: string }[] = []
  const add = (at: number, what: string) => {
    if (free(at)) found.push({ at, what })
  }
  for (const match of code.matchAll(PALETTE_CLASS)) add(match.index, match[0])
  for (const match of code.matchAll(HEX)) add(match.index, match[0])
  for (const match of code.matchAll(FUNCTION))
    add(match.index, call(code, match.index))
  for (const match of code.matchAll(/(["'`])([a-z]+)\1/g))
    if (NAMED.has(match[2])) add(match.index + 1, match[2])
  for (const match of code.matchAll(DECLARED)) {
    const value = match.index + match[0].indexOf(match[1])
    for (const word of namedIn(match[1])) add(value + word.index, word[0])
  }
  for (const match of code.matchAll(PAINT_BRACKETS))
    if (namedIn(match[1]).length > 0) add(match.index, match[0])
  return found.sort((a, b) => a.at - b.at).map(({ what }) => what)
}

/** The call that starts at `at` in `code`, to its closing bracket. */
function call(code: string, at: number): string {
  let depth = 0
  for (let end = code.indexOf("(", at); end < code.length; end++) {
    if (code[end] === "(") depth++
    else if (code[end] === ")" && --depth === 0) return code.slice(at, end + 1)
  }
  return code.slice(at)
}

// Corners (ADR 0080, decision 6).

/** The corners a component may take: the five levels, as the token list
 * has them (ADR 0080, decision 6), round, none, or its holder's. */
const LEVELS = Object.entries(TOKENS)
  .filter(([, { group }]) => group === "radius")
  .map(([name]) => name.replace(/-radius$/, ""))
const ROUNDING = new Set([...LEVELS, "full", "none", "[inherit]"])
const CORNER = new RegExp(
  `^(?:var\\(--(?:${LEVELS.join("|")})-radius\\)|0|9999px|50%|inherit)$`
)

/**
 * Each corner `code` rounds by other than a level, once for each place it
 * does: a Tailwind class that is no level (`rounded-md`, `rounded-[3px]`,
 * `rounded-(--x)`, a bare `rounded`), a CSS `border-radius` of another
 * value (px, `calc()`, `min()`), and a style's `borderRadius`.
 */
function corners(code: string): string[] {
  const found: string[] = []
  for (const [match, value] of code.matchAll(
    /(?<![\w./-])rounded(?:-(?:tl|tr|bl|br|ss|se|es|ee|[tblrse]))?(?:-(\w+|\[[^\]\s]*\]|\([^)\s]*\)))?(?![\w./-])/g
  ))
    if (value === undefined || !ROUNDING.has(value)) found.push(match)
  for (const [match, value] of code.matchAll(
    /(?<![\w-])border(?:-[a-z]+)*-radius\s*:\s*([^;{}"'`]+)/g
  ))
    if (!CORNER.test(value.trim())) found.push(match.trim())
  for (const [match] of code.matchAll(/\bborderRadius\b/g)) found.push(match)
  return found
}

// Type (decision 3).

/** Banda's type levels, each with its value, as `@theme` makes them. */
const TYPE = named("text")
/** The levels a literal size is written as instead, by their size in px;
 * code's level is for code alone, so it is offered for no other size. */
const SCALE = TYPE.flatMap(([name, value]) => {
  const [, number, unit] = /^([\d.]+)(px|rem)$/.exec(value) ?? []
  return number && name !== "code"
    ? [[`text-${name}`, px(number, unit)] as const]
    : []
})
/** Tailwind's own sizes, in px; `xs` and `sm` stay allowed until step 1b
 * (ADR 0113) renames them to `text-meta` and `text-ui`. */
const TAILWIND_SIZES: Record<string, number> = {
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
}

/** A length or a number, alone: `11px`, `0.8rem`, `1.5`. */
const LITERAL = /^-?[\d.]+(?:px|rem|em|pt|%)?$/

/** The level a size is written as: the one that is its custom property
 * (`text-prose` for `--prose-size`), or the nearest a literal one, the
 * larger on a tie; none for another value. */
function levelOf(size: string): string | undefined {
  const property = /--[\w-]+/.exec(size)?.[0]
  if (property) {
    const level = TYPE.find(([, value]) => value === `var(${property})`)
    return level && `text-${level[0]}`
  }
  const [, number, unit] = /^([\d.]+)(px|rem)$/.exec(size) ?? []
  if (!number || SCALE.length === 0) return undefined
  const pixels = px(number, unit)
  return SCALE.reduce((best, level) =>
    Math.abs(level[1] - pixels) <= Math.abs(best[1] - pixels) ? level : best
  )[0]
}

const TEXT_ARBITRARY = new RegExp(`${START}text-(${ARBITRARY})(?![\\w.-])`, "g")
const TEXT_NAMED = new RegExp(
  `${START}text-(${Object.keys(TAILWIND_SIZES).join("|")})(?![\\w.-])`,
  "g"
)
const LEADING = new RegExp(`${START}leading-\\[([^\\]\\s]*)\\]`, "g")

/** The sizes `code` writes as numbers or by Tailwind's names, and the line
 * heights it writes as numbers. */
function typeIn(code: string): Case[] {
  const cases: Case[] = []
  const size = (what: string, value: string, off = "is off the scale") => {
    const level = levelOf(value)
    cases.push(
      found(
        "type",
        what,
        level && `${off}: write \`${level}\`, or add a level to the theme`
      )
    )
  }
  for (const [match, value] of code.matchAll(TEXT_ARBITRARY)) {
    const inner = value.slice(1, -1)
    // A `var()` or a custom property alone is a colour, as Tailwind takes
    // it, unless it says it is a length.
    if (
      inner.startsWith("length:") ||
      LITERAL.test(inner) ||
      inner.startsWith("calc(")
    )
      size(match, inner)
  }
  for (const [match, name] of code.matchAll(TEXT_NAMED))
    size(match, `${TAILWIND_SIZES[name]}px`, "is Tailwind's size name")
  for (const [match, value] of code.matchAll(LEADING))
    if (LITERAL.test(value))
      cases.push(
        found(
          "type",
          match,
          "is a line height by number: a level brings its own, or write Tailwind's name (`leading-none`, `leading-tight`)"
        )
      )
  for (const [match, value] of code.matchAll(
    /(?<![\w-])font-size\s*:\s*([^;{}"'`\n]+)/g
  )) {
    const plain = value.replace(/!important/, "").trim()
    if (LITERAL.test(plain)) size(match.trim(), plain)
  }
  for (const [match, , value] of code.matchAll(
    /\bfontSize\s*:\s*(["'`]?)([\d.]+(?:px|rem|em|pt)?)\1(?![\w.(])/g
  ))
    size(match, /^[\d.]+$/.test(value) ? `${value}px` : value)
  return cases
}

// Shadows (decision 4).

/** Tailwind's shadow sizes, of each kind of shadow; any other word is an
 * elevation (`float`, `lift`, `none`) or a colour (`shadow-black/10`). */
const SIZES = new Set(["2xs", "xs", "sm", "md", "lg", "xl", "2xl"])

/** Whether `value`, a shadow as CSS or a class's brackets write it,
 * draws a ring: each of its shadows inset, with no blur. A ring in a
 * literal colour is that colour's case. */
function ring(value: string): boolean {
  return split(value, ",").every((shadow) => {
    const parts = split(shadow.trim(), /[\s_]/).filter(Boolean)
    const lengths = parts.filter((part) => LITERAL.test(part))
    return (
      parts.includes("inset") &&
      lengths.length >= 2 &&
      lengths.length <= 4 &&
      (lengths[2] === undefined || Number.parseFloat(lengths[2]) === 0)
    )
  })
}

/** `value` split by `by` outside brackets. */
function split(value: string, by: string | RegExp): string[] {
  const parts = [""]
  let depth = 0
  for (const char of value) {
    if (char === "(") depth++
    else if (char === ")") depth--
    if (depth === 0 && (typeof by === "string" ? char === by : by.test(char)))
      parts.push("")
    else parts[parts.length - 1] += char
  }
  return parts
}

/** Whether a shadow's `value`, as a declaration or a class's brackets
 * say it, draws other than no shadow, a name or a ring. */
const drawn = (value: string) =>
  value !== "none" && !byName(value) && !ring(value)

const SHADOW_CLASS = new RegExp(
  `${START}(?:inset-|drop-|text-)?shadow(?:-(${ARBITRARY}|[\\w.]+))?(?:/[\\w.\\[\\]%]+)?(?![\\w./(-]|\\s*:)`,
  "g"
)

/** The shadows `code` draws, each with where it starts and ends. */
function shadowsIn(code: string): { what: string; at: number; end: number }[] {
  const found: { what: string; at: number; end: number }[] = []
  const add = (match: RegExpExecArray, what = match[0]) =>
    found.push({ what, at: match.index, end: match.index + match[0].length })
  for (const match of code.matchAll(SHADOW_CLASS)) {
    const value = match[1]
    if (
      value === undefined ||
      SIZES.has(value) ||
      (value.startsWith("[") && drawn(value.slice(1, -1))) ||
      (value.startsWith("(") && !byName(value) && !value.startsWith("(color:"))
    )
      add(match)
  }
  for (const match of code.matchAll(
    /(?<![\w-])(?:box-shadow|text-shadow)\s*:\s*([^;{}"'`]+)/g
  ))
    if (drawn(match[1].trim())) add(match, match[0].trim().replace(/\s+/g, " "))
  for (const match of code.matchAll(
    /\b(?:boxShadow|textShadow)\s*:\s*(["'`])([^"'`]*)\1/g
  ))
    if (drawn(match[2].trim())) add(match)
  for (const match of code.matchAll(/(?<![\w-])drop-shadow\(/g)) {
    const what = call(code, match.index)
    found.push({ what, at: match.index, end: match.index + what.length })
  }
  return found.sort((a, b) => a.at - b.at)
}

// Layers (decision 5).

/** The layers by name, as `@theme` makes them (`--z-index-*`). */
const LAYERS = named("z-index").map(([name]) => name)
/** What a layer may be: a name, or what draws in order. */
const IN_ORDER = new Set([...LAYERS, "auto", "inherit", "0", "-1"])

const Z_CLASS = new RegExp(
  `${START}(-?)z-(${ARBITRARY}|\\w+)(?![\\w./-]|\\s*:)`,
  "g"
)

/** The layers `code` gives by number. */
function layersIn(code: string): string[] {
  const found: string[] = []
  for (const [match, minus, value] of code.matchAll(Z_CLASS)) {
    const layer = value.replace(/^\[(.*)\]$/, "$1")
    if (!byName(value) && !byName(layer) && !IN_ORDER.has(minus + layer))
      found.push(match)
  }
  for (const [match, value] of code.matchAll(
    /(?<![\w-])z-index\s*:\s*([^;{}"'`\n]+)/g
  ))
    if (!IN_ORDER.has(value.trim()) && !byName(value.trim()))
      found.push(match.trim())
  for (const [match, , value] of code.matchAll(
    /\bzIndex\s*:\s*(["'`]?)(-?\d+)\1/g
  ))
    if (!IN_ORDER.has(value)) found.push(match)
  return found
}

// Lengths (decision 7).

/** The utilities that space or size, whose brackets the grid holds. */
const SPACING =
  "-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|min-[wh]|max-[wh]|size|inset(?:-[xy])?|top|right|bottom|left|start|end|basis|translate-[xy]|indent|scroll-[mp][xytrblse]?)"
const LENGTH_CLASS = new RegExp(
  `${START}${SPACING}-\\[(-?[\\d.]+)(px|rem)\\](?![\\w./-])`,
  "g"
)

/** The lengths `code` writes in a class's brackets off the 4 px grid. */
function lengthsIn(code: string): string[] {
  return [...code.matchAll(LENGTH_CLASS)]
    .filter(([, number, unit]) => px(number, unit) % 4 !== 0)
    .map(([match]) => match)
}

/** Why each kind is refused, and what to write instead, by Banda UI's
 * names. */
const INSTEAD: Record<Kind, string> = {
  colour:
    "is a colour literal: write a token's class (`bg-muted`, `text-muted-foreground`), a token thinned (`bg-foreground/10`) or tokens mixed (`color-mix()` over `var(--…)`), or add a token to the theme",
  corner: `is on no corner level: write ${classes("rounded-", [...LEVELS, "full", "none"])}`,
  type: `is off the scale: write a level's name (${classes(
    "text-",
    TYPE.map(([name]) => name)
  )}), or add a level to the theme`,
  shadow:
    "is no elevation: write `shadow-float` for what floats, `shadow-lift` for what the Person carries, or none: most things stand apart by a line and a fill",
  layer: `is no named layer: write ${classes("z-", LAYERS)}: \`z-raised\` and \`z-float\` inside a Pane, the others the Window's`,
  length:
    "is off the 4 px grid: write Tailwind's step (`p-1`, `gap-1.5`) or a token",
}
