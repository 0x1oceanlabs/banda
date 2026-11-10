/**
 * General (ADR 0016, decision 8): Banda itself, the engine the window
 * reaches, its fence around the Harnesses (ADR 0083), and where the
 * settings files are.
 */
import { Button } from "@banda/ui/components/button"
import { Card } from "@banda/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@banda/ui/components/item"
import { useFence, useStatus } from "@banda/ui/hooks/use-status"
import { FolderOpenIcon } from "lucide-react"
import { useLookConfig } from "../look"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { FenceRow } from "./Fence"
import type { SectionProps } from "./sections"

export function General({ engine, lit, run }: SectionProps) {
  const settingsKey = useKeyLabel()("settings.open")
  const status = useStatus(engine)
  const fence = useFence(engine)
  const folder = useLookConfig()
  return (
    <Card className="gap-0 divide-y py-0">
      <Item className="rounded-none px-4">
        <ItemContent>
          <ItemTitle>Engine</ItemTitle>
          <ItemDescription className="text-xs">
            Banda's engine, which runs the Projects.
          </ItemDescription>
        </ItemContent>
        <ItemActions className="font-mono text-xs text-muted-foreground">
          {status.state === "open" ? status.engine : status.state}
        </ItemActions>
      </Item>
      {fence && (
        <FenceRow
          fence={fence}
          lit={lit === "fence"}
          onAgents={run && (() => run("settings.open", { link: "agents" }))}
        />
      )}
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
            Comes in over the tiles, from the Banda menu
            {settingsKey && ` or with ${settingsKey}`}; Esc, a click on the
            tiles or its × takes it away.
          </ItemDescription>
        </ItemContent>
      </Item>
    </Card>
  )
}
