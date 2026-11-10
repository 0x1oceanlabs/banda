/**
 * Files' pages (ADR 0073, decisions 5 and 6): an HTML file or an SVG
 * document, in a frame of the sandbox host, `app://preview`, by a token
 * the engine of the Pane's session gives for a page (ADR 0106, decision
 * 6). Its scripts run there on an origin of no one's, with no Banda, no
 * storage and nothing from the network; its source is a toggle away.
 */
import { InHeader } from "@banda/ui/components/pane-header"
import { useFileUrl } from "@banda/ui/hooks/use-file-url"
import type { PreviewProps } from "@banda/ui/module"
import { CodeIcon } from "lucide-react"
import { Facts, Loading } from "../Facts"
import { HeaderButton } from "../HeaderButton"
import CodeView from "./code"
import { useHeldUrl } from "./held"

export default function PageView(props: PreviewProps) {
  const { file, engine, project, kept, keep } = props
  const source = kept.source === true
  const minted = useFileUrl(
    engine,
    project,
    file.path,
    file.modified ?? undefined,
    "page"
  )
  const { url, broke } = useHeldUrl(minted, file)
  return (
    <>
      <InHeader>
        <HeaderButton
          label="Source"
          on={source}
          onClick={() => keep({ ...kept, source: !source })}
        >
          <CodeIcon />
        </HeaderButton>
      </InHeader>
      {source ? (
        <CodeView {...props} />
      ) : url === undefined ? (
        <Loading />
      ) : url === null ? (
        <Facts stat={file} note="This page cannot be shown." />
      ) : (
        // Its scripts run, and nothing else: no origin of its own.
        <iframe
          key={url}
          src={url}
          title={file.name}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onError={broke}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </>
  )
}
