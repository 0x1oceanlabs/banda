/**
 * General (ADR 0016, decision 8): Banda itself, the engine the window
 * reaches, and where the settings files are.
 */
import type { Engine } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@banda/ui/components/item"
import { useStatus } from "@banda/ui/hooks/use-status"
import { FolderOpenIcon } from "lucide-react"
import { useLookConfig } from "../look"

export function General({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const folder = useLookConfig()
  return (
    <Card className="gap-0 divide-y py-0">
      <Item className="rounded-none px-4">
        <ItemContent>
          <ItemTitle>Engine</ItemTitle>
          <ItemDescription className="text-xs">
            Banda's engine, which runs the Spaces.
          </ItemDescription>
        </ItemContent>
        <ItemActions className="font-mono text-xs text-muted-foreground">
          {status.state === "open" ? status.engine : status.state}
        </ItemActions>
      </Item>
      <Item className="rounded-none px-4">
        <ItemContent>
          <ItemTitle>Settings folder</ItemTitle>
          <ItemDescription className="font-mono text-xs break-all">
            {folder}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void window.banda?.settings.reveal("")}
          >
            <FolderOpenIcon />
            Open folder
          </Button>
        </ItemActions>
      </Item>
      <Item className="rounded-none px-4">
        <ItemContent>
          <ItemTitle>These settings</ItemTitle>
          <ItemDescription className="text-xs">
            A Pane: Alt+, opens it, from the window or the Banda menu; its ×
            closes it.
          </ItemDescription>
        </ItemContent>
      </Item>
    </Card>
  )
}
