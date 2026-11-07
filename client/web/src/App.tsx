import type { Engine } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { useProjects } from "@banda/ui/hooks/use-projects"
import { Previewers } from "@banda/ui/lib/previewers"
import { useMachine, useModules, useStatus } from "@banda/ui/hooks/use-status"
import { shownProjects } from "@banda/ui/lib/projects"
import { previewers } from "./registry"
import { Shell } from "./shell/Shell"
import { AskToShare } from "./sharing/AskToShare"

/**
 * The page: the engine's Projects, then the window. With no Project, a new
 * Thread is held on the machine until its first message or attachment.
 */
export function App({ engine }: { engine: Engine }) {
  const status = useStatus(engine)
  const machine = useMachine(engine)
  const modules = useModules(engine)
  // A Project added here shows at once, as the engine answered it.
  const { listed, put } = useProjects(engine)

  if (listed.state === "loading") {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (listed.state === "refused") {
    return (
      <p role="alert" className="p-6 text-sm text-muted-foreground">
        {listed.refusal.message}
      </p>
    )
  }
  const projects = [
    ...shownProjects(listed.value),
    ...listed.value.filter((s) => s.scratch && !s.archived),
  ]
  // The first Project is home until Banda makes a default one (ADR 0006);
  // one whose folder is missing opens nothing.
  const home = projects.find((project) => !project.missing && !project.scratch)
  if (!machine) return <Spinner />
  // Every Pane draws a file with the modules' previewers (ADR 0073).
  return (
    <Previewers value={previewers}>
      <Shell
        engine={engine}
        status={status}
        modules={modules}
        projects={projects}
        home={home?.id ?? machine}
        onCreated={put}
      />
      {projects.length > 0 && <AskToShare engine={engine} />}
    </Previewers>
  )
}
