import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "./button"

/** How long the check stays after a copy. */
const SHOWN_MS = 1500

/** A button that copies `text`, and shows a check for a moment after. */
function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string
  label?: string
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
      title={label}
      className={className}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export { CopyButton }
