/**
 * The modules this window has, by their window parts (ADR 0022,
 * decision 2): the one place in the window that names them. Every
 * registry is built from this list, in its order.
 */
import { agents } from "@banda/agents-pane"
import { browser } from "@banda/browser-pane"
import { clock } from "@banda/clock-pane"
import { harnesses } from "@banda/harnesses-pane"
import { files } from "@banda/files-pane"
import { git } from "@banda/git-pane"
import { pulls } from "@banda/pulls-pane"
import { terminal } from "@banda/terminal-pane"
import { notifications } from "@banda/notifications-pane"
import type { Module } from "@banda/ui/module"

export const modules: readonly Module[] = [
  agents,
  harnesses,
  terminal,
  browser,
  git,
  files,
  pulls,
  notifications,
  clock,
]
