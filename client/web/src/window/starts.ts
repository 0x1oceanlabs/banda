/**
 * Each module that runs starts once, with the window as it is when it
 * asks (ADR 0022): the browser opens a Pane for an Agent's tab.
 */
import { useEffect } from "react"
import type { WindowApi } from "@banda/ui/module"
import { modules as known } from "../modules"
import { runs } from "../registry"

export function useModulesStart(
  modules: readonly string[],
  api: WindowApi
): void {
  const running = known
    .filter((module) => runs(module, modules))
    .map((module) => module.id)
    .join()
  useEffect(() => {
    const stops = known
      .filter((module) => running.split(",").includes(module.id))
      .flatMap((module) => module.start?.(api) ?? [])
    return () => stops.forEach((stop) => stop())
  }, [running, api])
}
