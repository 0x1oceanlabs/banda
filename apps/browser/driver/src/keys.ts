/** The keyboard of a tab of the driver's: Playwright's, which reaches
 * that page alone in a Chromium no Person types in (ADR 0132, decision
 * 3). It has none of Banda's keys to refuse: no window is around it. */
import type { Page } from "playwright-core"
import { comboOf, type Keyboard } from "./hands"

export const keyboard = (page: Page): Keyboard => ({
  refuse: (combo) => void comboOf(combo),
  press: (combo) => page.keyboard.press(combo),
  erase: () => page.keyboard.press("Delete"),
  type: (text) => page.keyboard.type(text),
})
