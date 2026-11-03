/**
 * A Visual in its Thread (ADR 0037): the Agent's page in a frame kept
 * apart from Banda, wearing the look and following it, as tall as the
 * page says it is. The frame has an origin of its own and no
 * `allow-same-origin`, so the page runs its scripts and nothing of
 * Banda's; what it says is heard only from its own frame.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { SpaceId } from "@banda/contract"
import { onThemeChange } from "@banda/ui/lib/look"
import type { Fit, VisualId } from "@banda/contract/agents"
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

/** The look the window shows now. */
function lookNow(): VisualLook {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return visualLook(
    (token) => style.getPropertyValue(token),
    root.classList.contains("dark")
  )
}

export function Visual({
  space,
  visual,
  title,
  height,
  heights,
}: {
  space: SpaceId
  visual: VisualId
  title: string
  /** How tall the Agent said it is, till the page says. */
  height: number
  /** How tall the window found it at several widths, before it loads. */
  heights: Fit[]
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [fits, setFits] = useState<number>()
  /** How tall the frame is till its page says. */
  const [guess, setGuess] = useState(height)
  // The first look goes with the address; once the page is loaded, each
  // new one is posted, so it repaints without loading again.
  const [address] = useState(() =>
    lookedAt(visualAddress(space, visual), lookNow())
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
      if (said?.kind === "size") setFits(said.height)
      // A link opens only as its Person clicked it in the page.
      else if (
        said?.kind === "link" &&
        document.activeElement === own &&
        navigator.userActivation.isActive
      )
        window.open(said.url, "_blank", "noopener")
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [])

  return (
    <iframe
      ref={frame}
      src={address}
      title={title}
      sandbox={SANDBOX}
      loading="lazy"
      onLoad={post}
      style={{ height: fits ?? guess }}
      // The frame's scheme is the window's, as the page's is, so it stays
      // clear over the Thread.
      className="-mx-2 block w-[calc(100%+1rem)] border-0 bg-transparent [color-scheme:light] dark:[color-scheme:dark]"
    />
  )
}
