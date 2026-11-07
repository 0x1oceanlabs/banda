/**
 * What a module tells the Person, in plain data (ADR 0056, decision 2):
 * no code, so any module can say it by running `notifications.tell`, and
 * its buttons are actions by their id and args. Pure, so plain tests
 * cover it.
 */
import type { JsonValue } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { Chime } from "@banda/ui/sound"

/** One of its buttons: the action it runs, by its id, with its args. */
export type Button = { label: string; action: string; args?: Args }

export type Told = {
  /** One per thing: what it tells next replaces this. */
  key: string
  /** Its kind, which colours its edge and picks its Mark. */
  kind: Chime
  title: string
  /** The Project it is of, by name, when the window has more than one. */
  project?: string
  /** The Project it is of, by its ID: the window names it, as `project`. */
  in?: string
  /** The thing of that Project it tells of, as a Thread: while it is on
   * screen, nothing is told. */
  about?: string
  /** A line in code type, before the words. */
  code?: string
  /** What it says. */
  body?: string
  /** What the desktop's notification says instead. */
  notice?: string
  /** Its buttons, the main one first: two at most. */
  buttons: readonly Button[]
  /** What a click on it does, on its toast or the desktop's
   * notification: its first button's if it says nothing. */
  open?: Button
  /** It plays no sound. */
  silent?: boolean
  /** Its toast has a button that closes it. */
  close?: boolean
}

const KINDS = new Set<string>(["done", "asking", "failed"])

const text = (value: JsonValue | undefined): value is string =>
  typeof value === "string"

/** What `notifications.tell` was given, if it is a `Told`. */
export function toldOf(args: Args | undefined): Told | null {
  if (!args) return null
  const {
    key,
    kind,
    title,
    project,
    in: of,
    about,
    code,
    body,
    notice,
    buttons,
    open,
    silent,
    close,
  } = args
  if (!text(key) || !text(kind) || !KINDS.has(kind) || !text(title)) return null
  if (!Array.isArray(buttons)) return null
  const said = buttons.flatMap(buttonOf)
  const opens = buttonOf(open ?? null)[0]
  return {
    key,
    kind: kind as Chime,
    title,
    ...(text(project) ? { project } : {}),
    ...(text(of) ? { in: of } : {}),
    ...(text(about) ? { about } : {}),
    ...(text(code) ? { code } : {}),
    ...(text(body) ? { body } : {}),
    ...(text(notice) ? { notice } : {}),
    buttons: said.slice(0, 2),
    ...(opens ? { open: opens } : {}),
    ...(silent === true ? { silent } : {}),
    ...(close === true ? { close } : {}),
  }
}

/** What a click on its toast or its desktop notification runs. */
export function clicked(told: Told): Button | undefined {
  return told.open ?? told.buttons[0]
}

/** A button, if `value` is one. */
function buttonOf(value: JsonValue): Button[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const { label, action, args } = value
  if (!text(label) || !text(action)) return []
  const given =
    args && typeof args === "object" && !Array.isArray(args) ? { args } : {}
  return [{ label, action, ...given }]
}
