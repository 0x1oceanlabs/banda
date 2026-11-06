import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "./button"

/** How long the check stays after a copy. */
const SHOWN_MS = 1500

/** A button that copies `text`, and shows a check for a moment after.
 * `text` may be given as it is pressed, as a large value is written out
 * only then. */
function CopyButton({
  text,
  label = "Copy",
  title = label,
  icon = <CopyIcon />,
  className,
}: {
  text: string | (() => string)
  label?: string
  /** Its tooltip; its label unless said. */
  title?: string
  icon?: React.ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), SHOWN_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={title}
      className={className}
      onClick={() => {
        const copied = typeof text === "string" ? text : text()
        void navigator.clipboard.writeText(copied).then(() => setCopied(true))
      }}
    >
      {copied ? <CheckIcon /> : icon}
    </Button>
  )
}

export { CopyButton }
