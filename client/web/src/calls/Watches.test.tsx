import type { Engine, ProjectSummary } from "@banda/contract"
import type { WatchProps } from "@banda/ui/pane"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"

const heard: (string | undefined)[] = []

vi.mock("../registry", () => ({
  runs: () => true,
  watches: [
    {
      module: { id: "agents", engine: true },
      watch: {
        Watch: ({ host }: WatchProps) => {
          heard.push(host)
          return null
        },
      },
    },
  ],
}))

const { Watches } = await import("./Watches")

// What another host lists reads without waiting for this machine's marks
// to move only while its name reaches each Watch (#1061).
test("another host's Watches tell each Watch the host's name", () => {
  const project = { id: "p", name: "p" } as ProjectSummary
  renderToStaticMarkup(
    <Watches
      engine={{} as Engine}
      modules={["agents"]}
      projects={[project]}
      host="arc"
    />
  )
  expect(heard).toEqual(["arc"])
})
