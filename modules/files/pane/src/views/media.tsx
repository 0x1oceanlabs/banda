/**
 * Files' video and sound (ADR 0073, decision 6): Chromium's own players,
 * from the file host, which answers ranges, so a long file plays and
 * seeks at once. Their controls are quiet: no download, no speed, no
 * casting. A file Chromium cannot play, as HEVC without the hardware or
 * AVI, shows its facts and opens in its app.
 */
import { Button } from "@banda/ui/components/button"
import { openWithSystem } from "@banda/ui/lib/outside"
import type { PreviewProps } from "@banda/ui/module"
import { AppWindowIcon } from "lucide-react"
import { Facts, Loading } from "../Facts"
import { useHeldUrl } from "./held"

/** What a player leaves out of its controls. */
const QUIET = "nodownload noplaybackrate noremoteplayback"

export function Video({ file }: PreviewProps) {
  const { url, broke } = useHeldUrl(file.url, file)
  if (url === undefined) return <Loading />
  if (url === null) return <Unplayable {...file} />
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        // A new file plays from its start.
        key={url}
        src={url}
        controls
        controlsList={QUIET}
        disablePictureInPicture
        disableRemotePlayback
        preload="metadata"
        aria-label={file.name}
        onError={broke}
        className="size-full object-contain outline-none"
      />
    </div>
  )
}

export function Audio({ file }: PreviewProps) {
  const { url, broke } = useHeldUrl(file.url, file)
  if (url === undefined) return <Loading />
  if (url === null) return <Unplayable {...file} />
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="max-w-full truncate text-sm text-muted-foreground">
        {file.name}
      </p>
      <audio
        key={url}
        src={url}
        controls
        controlsList={QUIET}
        preload="metadata"
        aria-label={file.name}
        onError={broke}
        className="w-full max-w-md"
      />
    </div>
  )
}

/** A file Chromium cannot play: its facts, and its app. */
function Unplayable(file: PreviewProps["file"]) {
  return (
    <Facts stat={file} note="Banda cannot play this file.">
      <Button
        size="sm"
        variant="outline"
        className="mt-1"
        onClick={() => openWithSystem(file.path)}
      >
        <AppWindowIcon />
        Open in its app
      </Button>
    </Facts>
  )
}
