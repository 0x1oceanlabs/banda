/**
 * What the notifications module asks the desktop to show for its calls (ADR 0011,
 * decision 3): a notice per thing, or one for many that came at once, each
 * with the mark in its state as its icon.
 */
import {
  type MarkColors,
  MARK_WORDS,
  stillMark,
} from "@banda/ui/components/banda-mark"
import type { Chime } from "@banda/ui/sound"
import type { Notify } from "@banda/contract/look"
import type { Call } from "@banda/ui/pane"
import type { Desktop, Notice } from "./desktop"
import type { Told } from "./told"
import { loudestChime } from "./sound"

/** More calls than this at once make one notice that names them all. */
export const MANY = 2

/** The key of the notice for many. */
export const SUMMARY = "calls"

const ANSWER: Record<Chime, string> = {
  done: "Open",
  asking: "Answer",
  failed: "Open",
}

/** A notice of one call. One that waits for the Person stays. */
export function noticeOf(call: Call, detail: boolean): Notice {
  const said = MARK_WORDS[call.chime]
  return {
    key: call.key,
    title: call.title,
    body: detail && call.detail ? `${said} · ${call.detail}` : said,
    answer: ANSWER[call.chime],
    lasts: call.chime !== "done",
  }
}

/** The action that goes to a call's thing: `{ space, about, pane }`. */
export const GO_TO = "notifications.go-to"

/**
 * A call as a toast tells it (ADR 0056, decision 2), in the words of its
 * system notification, with a button that goes there.
 */
export function toldOfCall(call: Call, detail: boolean): Told {
  const { key, title, body, answer } = noticeOf(call, detail)
  const { space, about, pane } = call
  return {
    key,
    kind: call.chime,
    title,
    ...(body ? { body } : {}),
    buttons: [{ label: answer, action: GO_TO, args: { space, about, pane } }],
  }
}

/** One notice of many calls at once, named in it. */
export function summaryOf(calls: readonly Call[]): Notice {
  return {
    key: SUMMARY,
    title: `${calls.length} Threads call you`,
    body: calls.map((call) => call.title).join(", "),
    answer: "Show",
    lasts: calls.some((call) => call.chime !== "done"),
  }
}

/** The loudest of many calls, for the summary's icon. */
export function loudestOf(calls: readonly Call[]): Chime {
  return loudestChime(calls.map((call) => call.chime)) ?? "done"
}

const icons = new Map<string, Promise<string | undefined>>()

/**
 * The mark still in `chime`'s state, in the look's colours, as a PNG data
 * URL: the desktop shows no SVG. None if the page cannot draw it.
 */
export function iconOf(chime: Chime): Promise<string | undefined> {
  const colors = lookColors()
  const key = `${chime}:${colors.body}:${colors.attention}:${colors.destructive}`
  let icon = icons.get(key)
  if (!icon) {
    icon = drawn(stillMark(chime, colors))
    icons.set(key, icon)
  }
  return icon
}

function lookColors(): MarkColors {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback
  return {
    body: color("--foreground", "#1a1a1a"),
    attention: color("--attention", "#ff5a1f"),
    destructive: color("--destructive", "#e7000b"),
  }
}

/** An SVG drawn on a canvas, as a PNG. */
async function drawn(svg: string): Promise<string | undefined> {
  try {
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = 112
    canvas.height = 112
    canvas.getContext("2d")?.drawImage(image, 0, 0, 112, 112)
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  }
}

/** Whether the desktop is quiet now, when `[notify]` keeps its quiet. */
export async function quietNow(
  notify: Notify,
  desktop: Desktop | undefined
): Promise<boolean> {
  return desktop && notify.quiet === "desktop"
    ? await desktop.quiet().catch(() => false)
    : false
}
