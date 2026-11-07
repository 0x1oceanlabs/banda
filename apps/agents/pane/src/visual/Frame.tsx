/**
 * The Frame (ADR 0062, decision 7; ADR 0091, decision 6): a page apart
 * from Banda in a sandboxed frame, wearing the look and following it, as
 * tall as the page says it is, its links and its keys passed on as the
 * MCP Apps words say (ADR 0037, decisions 4 and 5). A Visual's entry, its
 * preview and its Pane draw it; an MCP App's `ui://` page will too.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ProjectId } from "@banda/contract"
import type { Fit, VisualId } from "@banda/contract/agents"
import { onThemeChange } from "@banda/ui/lib/look"
import {
  heard,
  heightAt,
  lookedAt,
  lookMessage,
  SANDBOX,
  visualAddress,
  type VisualLook,
  visualLook,
} from "./visual-frame"

/** A Visual as its Thread keeps it, and as its Pane's args. The frame
 * has an origin of its own and no `allow-same-origin`, so the page runs
 * its scripts and nothing of Banda's; what it says is heard only from its
 * own frame. */
export type VisualArgs = {
  visual: VisualId
  title: string
  /** How tall the Agent said it is, till the page says. */
  height: number
  /** How tall the window found it at several widths, before it loads. */
  heights: Fit[]
}

/** The look the window shows now. */
function lookNow(): VisualLook {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return visualLook(
    (token) => style.getPropertyValue(token),
    root.classList.contains("dark")
  )
}

/** The page in its frame, as wide as its place and as tall as the page,
 * at `zoom`: laid out that much narrower, then drawn that much larger, as
 * a browser zooms. */
export function VisualFrame({
  project,
  visual,
  title,
  height,
  heights,
  zoom = 1,
  className,
}: VisualArgs & { project: ProjectId; zoom?: number; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [fits, setFits] = useState<number>()
  /** How tall the frame is till its page says. */
  const [guess, setGuess] = useState(height)
  // The first look goes with the address; once the page is loaded, each
  // new one is posted, so it repaints without loading again.
  const [address] = useState(() =>
    lookedAt(visualAddress(project, visual), lookNow())
  )
  const post = () =>
    frame.current?.contentWindow?.postMessage(lookMessage(lookNow()), "*")

  useEffect(() => onThemeChange(post), [])

  // Till the page says its height, the frame takes the one the window
  // found for its width, from its first paint.
  useLayoutEffect(() => {
    const own = frame.current
    if (!own || heights.length === 0 || fits !== undefined) return
    const fit = () => setGuess(heightAt(heights, own.clientWidth, height))
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(own)
    return () => watch.disconnect()
  }, [heights, height, fits])

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const own = frame.current
      if (!own || event.source !== own.contentWindow) return
      const said = heard(event.data)
      if (!said) return
      if (said.kind === "size") return setFits(said.height)
      // Keys still work after the click's transient activation expires.
      if (document.activeElement !== own) return
      if (said.kind === "link") {
        if (navigator.userActivation.isActive)
          window.open(said.url, "_blank", "noopener")
      }
      // A key the page left goes on from its frame, as one pressed on it.
      else
        own.dispatchEvent(
          new KeyboardEvent("keydown", {
            ...said.key,
            bubbles: true,
            cancelable: true,
          })
        )
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [])

  const tall = fits ?? guess
  return (
    <div className={className} style={{ height: tall * zoom }}>
      <iframe
        ref={frame}
        src={address}
        title={title}
        sandbox={SANDBOX}
        loading="lazy"
        onLoad={post}
        style={{
          width: `${100 / zoom}%`,
          height: tall,
          transform: `scale(${zoom})`,
        }}
        // The frame's scheme is the window's, as the page's is, so it
        // stays clear over the Thread.
        className="block origin-top-left border-0 bg-transparent [color-scheme:light] dark:[color-scheme:dark]"
      />
    </div>
  )
}
