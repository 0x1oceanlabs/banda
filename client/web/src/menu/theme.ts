/**
 * The theme, as the Banda menu offers it (ADR 0098, decision 21; ADR
 * 0007): light, dark or as the system, where the theme has both, and
 * Themes…, the themes there are. The sidebar's foot held it until then.
 * Its rows write look.toml, as Settings → Appearance does, and the look
 * brings the change back. Plain data, as the rest of the menu is, but the
 * one write the window hands it.
 */
import type { Listed, Look } from "@banda/contract/look"
import { tomlOf } from "@banda/contract/settings"
import type { WindowApi } from "@banda/ui/module"
import { logged } from "../sidebar/write-setting"

/** Which scheme shows: one, or the system's. */
export type Shown = Look["mode"]

/** The theme in force, its light or dark, and whether it has both. */
export interface ThemeNow {
  /** Its name, as look.toml's `theme` takes it: `"platform"` when the
   * file names none, as that is the default; none for a pair. */
  theme?: string
  /** What the menu calls the theme that shows. */
  label?: string
  mode: Shown
  both: boolean
  /** The one scheme a theme with one has. */
  only?: "light" | "dark"
}

/** The theme before the first look comes. */
export const BEFORE: ThemeNow = { mode: "system", both: true }

/** What look.toml's `theme` says for this device's own. */
const PLATFORM = "platform"

/** Banda's own themes by the names the menu gives them (ADR 0100,
 * decision 2); in files they are `banda`, `macos` and `omarchy`. */
const TITLES: Readonly<Record<string, string>> = {
  [PLATFORM]: "This device's",
  banda: "Banda",
  macos: "Banda macOS",
  omarchy: "Banda Omarchy",
}

/** A theme as the menu names it: Banda's own by their titles, any other
 * by its own name. */
const titleOf = (name: string) => TITLES[name] ?? name

/** One scheme of a theme of both, as its name ends. */
const SCHEME = /-(light|dark)$/

/** The theme in force, as the look says it. */
export function themeNowOf(look: Look | null): ThemeNow {
  if (!look) return BEFORE
  const mine = look.settings["look.toml"]
  const said = mine?.theme?.value
  const mode = mine?.mode?.value
  const { light, dark } = look.schemes
  // Each scheme's theme is a layer: two for a pair, Banda's own included,
  // which are named <theme>-light and <theme>-dark (banda, macos).
  const layers = look.sources.filter((one) => one.layer === "theme")
  const own =
    layers.length > 1 && layers.every((one) => one.origin === "banda")
      ? layers[0]?.name?.replace(SCHEME, "")
      : undefined
  // A file that names no theme takes "platform", the default: this
  // device's own (ADR 0100, decision 2). The label names the theme it
  // takes, as that is what shows.
  const theme =
    said === undefined ? PLATFORM : typeof said === "string" ? said : undefined
  const shown = theme === PLATFORM ? (own ?? layers[0]?.name) : theme
  return {
    theme,
    label:
      shown === undefined
        ? layers.map((one) => one.name).join(" / ")
        : titleOf(shown),
    mode: mode === "light" || mode === "dark" ? mode : look.mode,
    both: light !== undefined && dark !== undefined,
    only: dark && !light ? "dark" : light && !dark ? "light" : undefined,
  }
}

/** What the theme's rows are drawn from: the theme in force, and the
 * themes there are, once the desktop has said them. */
export type Theming = { now: ThemeNow; listed: readonly Listed[] }

/** The schemes, in the menu's order. */
export const SCHEMES: readonly { mode: Shown; title: string }[] = [
  { mode: "light", title: "Light" },
  { mode: "dark", title: "Dark" },
  { mode: "system", title: "As the system" },
]

/** The theme's branch, by name. */
export const THEME = "Theme"
/** The themes' branch, by name, and as its row says it. */
export const THEMES = "Themes"
export const THEMES_ROW = "Themes…"

/** A row that writes look.toml's `key`: a scheme to show, or a theme. */
export type LookRow = {
  kind: "look"
  id: string
  title: string
  /** After the title, dimmer: what the theme has. */
  about?: string
  /** It is the one in force, and ticked. */
  current: boolean
} & ({ key: "mode"; value: Shown } | { key: "theme"; value: string })

/** What the theme's row says beside its name: the theme, then its scheme,
 * or that it has one only. */
export function themeDetail(now: ThemeNow): string {
  const scheme = now.both
    ? SCHEMES.find((one) => one.mode === now.mode)?.title
    : `${now.only ?? "one scheme"} only`
  return [now.label, scheme].filter(Boolean).join(" · ")
}

/** The schemes to show, the one in force ticked. A theme with one scheme
 * offers none: it has nothing to switch to, and Themes… is the way out. */
export function schemeRows(now: ThemeNow): LookRow[] {
  if (!now.both) return []
  return SCHEMES.map(({ mode, title }) => ({
    kind: "look",
    id: `look.mode.${mode}`,
    key: "mode",
    value: mode,
    title,
    current: now.mode === mode,
  }))
}

/** Banda's own pairs, light and dark, and what each is. */
const PAIRS: readonly { name: string; about: string }[] = [
  { name: "banda", about: "light and dark" },
  { name: "macos", about: "the Mac's, light and dark" },
]

/**
 * A theme as `banda look themes` lists it, whole: the list has each scheme
 * of a theme of both by itself, as `<theme>-light` and `<theme>-dark`, and
 * look.toml takes the two by the theme's own name. The two halves come
 * from one place, so two folders of one scheme each, named so, stay two.
 */
function wholeOf(
  one: Listed,
  listed: readonly Listed[]
): { name: string; about: string } {
  const scheme = SCHEME.exec(one.name)?.[1]
  const stem = one.name.replace(SCHEME, "")
  const other = `${stem}-${scheme === "light" ? "dark" : "light"}`
  const both =
    scheme !== undefined &&
    listed.some(
      (half) =>
        half.name === other &&
        half.origin === one.origin &&
        half.folder === one.folder
    )
  return both
    ? { name: stem, about: "light and dark" }
    : { name: one.name, about: one.mode }
}

/**
 * The themes to pick, the one look.toml names ticked: this device's own,
 * the default, then Banda's own pairs, then Omarchy's, which follows it,
 * where it has a current one, then each theme `banda look themes` lists,
 * one of both schemes once, by its own name. A name comes once, as
 * look.toml takes one theme by it, so Banda's own, there before the list
 * answers, are not listed again. `listed` is empty until the desktop
 * answers, and without it.
 */
export function themeRows(now: ThemeNow, listed: readonly Listed[]): LookRow[] {
  const current = listed.some((one) => one.origin === "current")
  // This device's names the theme it takes while it is the one in force.
  const device =
    now.theme === PLATFORM && now.label
      ? `the default, ${now.label} here`
      : "the default"
  const themes = [
    { name: PLATFORM, about: device },
    ...PAIRS,
    ...(current ? [{ name: "omarchy", about: "follows Omarchy" }] : []),
    ...listed
      .filter((one) => one.origin !== "current")
      .map((one) => wholeOf(one, listed)),
  ].filter(
    (one, at, all) => all.findIndex((first) => first.name === one.name) === at
  )
  return themes.map(({ name, about }) => ({
    kind: "look",
    id: `look.theme.${name}`,
    key: "theme",
    value: name,
    title: titleOf(name),
    about,
    current: now.theme === name,
  }))
}

const LOOK = "look.toml"

/** Writes the row's key of look.toml; the look brings the change back,
 * and what went wrong goes to the console. */
export function writeLook(
  write: WindowApi["writeSetting"],
  { key, value }: LookRow
) {
  logged(LOOK, write(LOOK, key, tomlOf(value)))
}
