// @vitest-environment happy-dom
/**
 * The Window's hosts know this machine's Projects before any effect of
 * what the Window draws runs (ADR 0106, decision 1): a module's start,
 * which acts on the home Project at once, finds it this machine's on the
 * Window's first draw, never one no machine has, which fails closed.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { FORGETTING, KeptHosts, useOurs } from "@banda/core/react"
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { expect, test } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("a module's start, as the Window first draws, acts on this machine's home Project on this machine's engine, not as one no machine has", async () => {
  const here = { here: true } as unknown as Engine
  const hosts = new KeptHosts(
    {
      follow: () => undefined,
      engine: () => Promise.reject(new Error("No other machine here.")),
      start: () => undefined,
    },
    FORGETTING,
    here
  )
  const home = { id: "home" } as ProjectSummary
  const listed = { state: "ready", value: [home] } as const
  const started: unknown[] = []
  // A module's start, as the Shell runs it in an effect of its own.
  const Start = () => {
    useEffect(() => {
      try {
        started.push(hosts.sessionOf(home.id as ProjectId))
      } catch (error) {
        started.push(error)
      }
    }, [])
    return null
  }
  // The Window, which tells its hosts its Projects and draws the Shell.
  const Window = () => {
    useOurs(hosts, listed, "m0" as ProjectId)
    return <Start />
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(<Window />))
  expect(started).toEqual([here])
  act(() => root.unmount())
})
