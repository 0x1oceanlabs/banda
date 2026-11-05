/** What the Banda menu finds of the browser (ADR 0022, decision 4): the
 * words typed as a page, the address or a search for them. Its tabs and
 * history come later. */
import { useLayoutEffect, useMemo } from "react"
import type { FindProps, MenuRow, Source } from "@banda/ui/module"
import { GlobeIcon } from "lucide-react"
import { isAddress, useAddressOf } from "./address"

export const webSource: Source = {
  id: "browser.web",
  label: "",
  Find: FindWeb,
}

function FindWeb({ words, here, found }: FindProps) {
  const addressOf = useAddressOf()
  const { entered, project } = here
  const rows = useMemo(
    (): MenuRow[] =>
      entered || !words
        ? []
        : [
            {
              id: "browser.web",
              title: isAddress(words)
                ? `Open ${words}`
                : `Search the web: “${words}”`,
              icon: (
                <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
              ),
              run: (window) =>
                window.run("browser.open", {
                  address: addressOf(words),
                  project,
                }),
            },
          ],
    [entered, words, project, addressOf]
  )
  useLayoutEffect(() => found(rows), [found, rows])
  return null
}
