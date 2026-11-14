import type { MouseEvent } from "react"
import type { ProjectId } from "@banda/contract"
import { BandaMark, MARK_WORDS } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { type Run, useRun } from "@banda/core/react"
import { notNow } from "../../trust/not-now"
import { PROJECT_CARD } from "../../trust/TrustCard"
import {
  PROJECT_LOOK,
  type ProjectAsks,
  type ProjectCall,
} from "../model/inbox"
import { useOpen } from "../list/open"
import { ProjectMenu } from "../list/ProjectMenu"
import { Card } from "./Card"
import { CardTitle, MarkCell, Says } from "./parts"

/** What a Project's card says (ADR 0098, decision 16): its title, why
 * it asks, which its tooltip and a screen reader tell past its folder,
 * and its two acts, the first Enter's. Line 2 is "Project" and its
 * folder, as a long one cuts the line. */
export function projectSays({ project, asks }: ProjectCall): {
  title: string
  why: string
  acts: readonly [string, string]
} {
  return asks === "trust"
    ? {
        title: `Trust “${project.name}”?`,
        why: "Its settings, hooks and MCP servers wait for your trust.",
        acts: ["Trust…", "Not now"],
      }
    : {
        title: `“${project.name}” is missing`,
        why: "Its folder moved or was deleted.",
        acts: ["Locate…", "Remove…"],
      }
}

/**
 * A Project card's first act, as its first button and Enter on its pick
 * run it, by the Window's actions: Trust… asks on the trust card by the
 * card (`projects.trust`, #947), Locate… opens the Banda menu where the
 * folder was (`open`, as it opens a menu).
 */
export function firstAct(
  run: Run,
  open: Run,
  project: ProjectId,
  asks: ProjectAsks
): void {
  if (asks === "trust") run("projects.trust", { project, trusted: true })
  else open("projects.locate", { project })
}

/**
 * A Project that waits for the Person, a card first in Your turn (ADR
 * 0098, decision 16): one to trust, whose Not now puts it off on this
 * device; one whose folder is missing, whose Remove… asks first. Its
 * lines are a card's in Your turn, drawn by the one `Card`: its mark and
 * title; "Project" and its folder; its two acts. It is an option of the
 * list (decision 13), which keys pick, with no focus of its own: Enter
 * does its first act; `S`, `Z` and `U` do nothing, as they act on Threads
 * alone; Shift+F10 opens the Project's menu, as a right click does. Its
 * buttons, as a card's acts, are no Tab stop, and hidden from a screen
 * reader, which hears the card and has its keys.
 */
export function ProjectCard({
  call,
  stop,
  picked,
}: {
  call: ProjectCall
  /** Its key as a stop of the pick. */
  stop: string
  picked: boolean
}) {
  const run = useRun()
  const open = useOpen()
  const { project, asks } = call
  const { title, why, acts } = projectSays(call)
  const line = `Project ${project.folder}. ${why}`
  const look = PROJECT_LOOK[asks]
  const [first, second] = acts
  // The focus stays where it was: on the list.
  const keep = (event: MouseEvent) => event.preventDefault()
  return (
    <ProjectMenu project={project} asks={asks}>
      <Card
        card={{
          stop,
          picked,
          name: title,
          description: `${line} ${first} or ${second}`,
          data: { [PROJECT_CARD]: project.id, "data-asks": asks },
          lines: [
            {
              left: (
                <>
                  <MarkCell>
                    <BandaMark
                      variant="agent"
                      state={look}
                      playful={0}
                      label={MARK_WORDS[look]}
                      className="size-4 shrink-0"
                    />
                  </MarkCell>
                  <CardTitle title={title} tip={title} strong />
                </>
              ),
            },
            {
              left: <Says word="Project" text={project.folder} tip={line} />,
            },
          ],
          // Its buttons run the Window's actions by id, as Enter and its
          // menu do (`firstAct`, `projects.remove`); Not now is this
          // device's alone, kept by `notNow`, and is no action.
          buttons: (
            <>
              <Button
                variant="outline"
                size="xs"
                tabIndex={-1}
                onMouseDown={keep}
                onClick={() => firstAct(run, open, project.id, asks)}
              >
                {first}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                tabIndex={-1}
                className="text-muted-foreground"
                onMouseDown={keep}
                onClick={() =>
                  asks === "trust"
                    ? notNow(project.id)
                    : run("projects.remove", { project: project.id })
                }
              >
                {second}
              </Button>
            </>
          ),
        }}
      />
    </ProjectMenu>
  )
}
