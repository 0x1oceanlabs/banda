/**
 * The Agents section of Settings (ADR 0016, decision 7), as the agents App
 * declares it: its Harnesses' accounts on cards, which it draws itself,
 * then `agents.toml`'s rows. Settings gives it the engine of the machine
 * it shows, that machine's files through its engine (ADR 0108, decision
 * 1), and a place over the settings for the Pane a sign-in opens, a
 * terminal. The Harnesses are the machine's (ADR 0040): they show before
 * any Project.
 */
import { useMemo } from "react"
import { Spinner } from "@banda/ui/components/spinner"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { shownProjects } from "@banda/ui/lib/projects"
import type { Section, SectionProps } from "@banda/ui/settings"
import { BotIcon } from "lucide-react"
import { AgentsSettings, type SettingsFile } from "./AgentsSettings"
import { FENCE_LINK } from "./fence"

function Agents({ engine, lit, run, writer, reveal, open }: SectionProps) {
  // A machine's settings file, which keeps the mode the Person chooses
  // for a Harness's new Threads: only Full access chosen here counts
  // where the fence does not hold (ADR 0083).
  const files = useMemo(() => {
    const fileOf = (name: string): SettingsFile => ({
      set: (key, value) => writer.set(name, key, value),
      reset: (key) => writer.reset(name, key),
      reveal: reveal && (() => reveal(name)),
    })
    return {
      agents: fileOf("agents.toml"),
      harnesses: fileOf("harnesses.toml"),
    }
  }, [writer, reveal])
  // Any Project offers what a new Thread starts with, and runs a terminal:
  // the first, as the window's home, once there is one.
  const { listed } = useProjects(engine)
  if (listed.state === "loading") return <Spinner />
  const project =
    listed.state === "ready"
      ? shownProjects(listed.value).find((s) => !s.missing)?.id
      : undefined
  return (
    <AgentsSettings
      engine={engine}
      project={project}
      open={(pane) => project && open(pane, project)}
      harnesses={files.harnesses}
      agents={files.agents}
      lit={lit}
      onFence={() => run?.("settings.open", { link: FENCE_LINK })}
    />
  )
}

export const agentsSection: Section = {
  id: "agents",
  title: "Agents",
  icon: BotIcon,
  files: [
    { name: "harnesses.toml" },
    { name: "agents.toml", tables: ["start"], drawn: true },
    { name: "agents.toml", title: "Writing to an Agent" },
  ],
  about:
    "The Harnesses Banda starts Threads with, and what a message written while an Agent works does.",
  Body: Agents,
}
