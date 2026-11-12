/**
 * The Frame (ADR 0062, decision 7; ADR 0091, decision 6): a page apart
 * from Banda in a sandboxed frame, wearing the look and following it, as
 * tall as the page says it is, its links and its keys passed on as the
 * MCP Apps words say (ADR 0037, decisions 4 and 5). A Visual's entry, its
 * preview and its Pane draw it; an MCP App's `ui://` page will too.
 *
 * A Visual another machine keeps is drawn the same (ADR 0106, decision
 * 6): its engine gives a token for the page, asked for through the Pane's
 * session as the frame comes near, and the address names it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChartLineIcon } from "lucide-react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Fit, VisualId } from "@banda/contract/agents"
import { saidByAPage } from "@banda/ui/lib/keys"
import { onThemeChange } from "@banda/ui/lib/look"
import {
  heard,
  heightAt,
  lookedAt,
  lookMessage,
  SANDBOX,
  visualAddress,
  visualAddressOn,
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

/** Where a Visual's Project is, and what its frame asks of its Pane. */
export type VisualPlace = {
  /** The Pane's session: the engine of the machine that keeps the page. */
  engine: Engine
  project: ProjectId
  /** That machine, by its name in `hosts.toml`; none for this one. */
  host?: string
  /** Opens a web address on this device, through the router (ADR 0106,
   * law 2). */
  openLink: (url: string) => void
}

/** How far from showing a frame of another machine's asks for its page. */
const NEAR = "800px"

/**
 * Where the frame under `near` loads the page from, with its first look.
 * This machine's is known at once. Another machine's is asked for once
 * the frame comes near showing, since its token lasts an hour and a long
 * Thread's far Visuals may load later than that: undefined till then and
 * while its engine answers, which waits while that machine is away, as a
 * read may; null when it gives none, as an engine older than the method.
 */
function useAddress(
  { engine, project, host }: VisualPlace,
  visual: VisualId,
  near: React.RefObject<HTMLElement | null>
): string | null | undefined {
  // The first look goes with the address; once the page is loaded, each
  // new one is posted, so it repaints without loading again.
  const [address, setAddress] = useState<string | null | undefined>(() =>
    host === undefined
      ? lookedAt(visualAddress(project, visual), lookNow())
      : undefined
  )
  useEffect(() => {
    const own = near.current
    if (host === undefined || !own) return
    let current = true
    const ask = () =>
      engine.call("agents.visual_link", { visual }, { project }).then(
        ({ token }) =>
          current &&
          setAddress(lookedAt(visualAddressOn(host, token), lookNow())),
        () => current && setAddress(null)
      )
    if (typeof IntersectionObserver === "undefined") {
      void ask()
      return () => {
        current = false
      }
    }
    const watch = new IntersectionObserver(
      (seen) => {
        if (!seen.some((one) => one.isIntersecting)) return
        watch.disconnect()
        void ask()
      },
      { rootMargin: NEAR }
    )
    watch.observe(own)
    return () => {
      current = false
      watch.disconnect()
    }
  }, [engine, project, host, visual, near])
  return address
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
  place,
  visual,
  title,
  height,
  heights,
  zoom = 1,
  className,
}: VisualArgs & { place: VisualPlace; zoom?: number; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const held = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState<number>()
  /** How tall the frame is till its page says. */
  const [guess, setGuess] = useState(height)
  const address = useAddress(place, visual, held)
  const openLink = useRef(place.openLink)
  useLayoutEffect(() => {
    openLink.current = place.openLink
  })
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
    // Its frame comes with its address, for another machine's.
  }, [heights, height, fits, address])

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
        if (navigator.userActivation.isActive) openLink.current(said.url)
      }
      // A key the page left goes on from its frame, as one pressed on it,
      // but as the page's: it runs nothing that acts as the Person.
      else
        own.dispatchEvent(
          saidByAPage(
            new KeyboardEvent("keydown", {
              ...said.key,
              bubbles: true,
              cancelable: true,
            })
          )
        )
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [])

  const tall = fits ?? guess
  // Its machine's engine gave no page for it.
  if (address === null)
    return (
      <p className="flex items-center gap-2 text-ui text-muted-foreground">
        <ChartLineIcon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">
          {place.host} gave no page for this Visual.
        </span>
      </p>
    )
  // Till its address is known, its place is held at its height.
  if (address === undefined)
    return (
      <div ref={held} className={className} style={{ height: tall * zoom }} />
    )
  return (
    <div ref={held} className={className} style={{ height: tall * zoom }}>
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
