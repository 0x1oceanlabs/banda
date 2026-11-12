/**
 * Class names merged as Tailwind resolves them. The shadcn CLI writes `cn`
 * imports through this alias (components.json), and `@banda/ui`'s own
 * components import it from here, so the merge knows Banda's own values:
 * the type scale's levels are font sizes, not colours (ADR 0113, decision
 * 3), the five corners are radii (ADR 0080, decision 6), and the
 * elevations are shadows (ADR 0113, decision 4). Without that,
 * `cn("text-muted-foreground", "text-meta")` drops the colour.
 */
import { TOKENS } from "@banda/contract/look"
import { createCn } from "cn/config"

/** The type scale's levels, one for each size the theme's tokens give
 * (`meta` for `--meta-size`), as `@theme` names them `text-meta`. */
const LEVELS = Object.entries(TOKENS).flatMap(
  ([token, { group }]) =>
    (group === "font" && /^([a-z]+)-size$/.exec(token)?.slice(1)) || []
)

/** The elevations: the theme's (`float` for `--float-shadow`), and the
 * Window's own three, whose shapes `globals.css` writes. */
const ELEVATIONS = [
  ...Object.entries(TOKENS).flatMap(
    ([token, { group }]) =>
      (group === "elevation" && /^([a-z]+)-shadow$/.exec(token)?.slice(1)) || []
  ),
  "tile",
  "focus",
  "panel",
]

export const cn = createCn({
  extend: {
    theme: {
      radius: ["window", "tile", "card", "control", "small"],
      shadow: ELEVATIONS,
    },
    classGroups: { "font-size": [{ text: LEVELS }] },
  },
})
