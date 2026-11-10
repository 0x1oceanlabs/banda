/**
 * Class names merged as Tailwind resolves them. The shadcn CLI writes `cn`
 * imports through this alias (components.json), and `@banda/ui`'s own
 * components import it from here, so the merge knows Banda's own values:
 * the chat's sizes are font sizes, not colours (ADR 0058), and the five
 * corners are radii (ADR 0080, decision 6). Without that,
 * `cn("text-muted-foreground", "text-code")` drops the colour.
 */
import { createCn } from "cn/config"

export const cn = createCn({
  extend: {
    theme: { radius: ["window", "tile", "card", "control", "small"] },
    classGroups: { "font-size": [{ text: ["prose", "meta", "code"] }] },
  },
})
