import type { Engine } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { RowFrame, Rows } from "../settings/SettingRow"
import { asideWords, useBringBack } from "../tiling/AsidePill"
import { useArranged } from "../tiling/useArranged"

/**
 * The workspaces set aside, in Settings → Projects too, while there are
 * some: what is aside, and Bring them back.
 */
export function AsideRow({ engine }: { engine: Engine }) {
  const live = useArranged(engine)
  const { busy, problem, bring } = useBringBack(engine)
  const aside = live.state === "ready" ? live.view.aside : null
  if (!aside) return null
  return (
    <Rows>
      <RowFrame
        dataKey="aside"
        title="Workspaces set aside"
        about={`${asideWords(aside)}, set aside when Banda's window broke. They come back after your workspaces.`}
        wrong={problem ? [problem] : []}
      >
        <Button size="sm" disabled={busy} onClick={bring}>
          Bring them back
        </Button>
      </RowFrame>
    </Rows>
  )
}
