/**
 * What the window says when it broke, or when its last starts did (ADR
 * 0039, decision 2): it can open again, or open without the workspaces,
 * which the engine sets aside, not deletes, until the Person brings them
 * back. Drawn alone, with nothing of the window that broke.
 */
import { useId } from "react"
import type { Engine } from "@banda/contract"
import { BandaMark } from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { useAct } from "@banda/ui/hooks/use-act"

export type Broke =
  /** The page broke while it ran, on what it said. */
  | { what: "page"; said: string }
  /** The last starts broke. */
  | { what: "starts" }

const TEXT = {
  page: {
    title: "Banda's window broke",
    body: "What broke is kept in Settings → Problems. Your Threads and workspaces are kept by the engine.",
    again: "Open again",
  },
  starts: {
    title: "Banda didn't start the last two times",
    body: "It may be something in your workspaces. Open without them this time? They are set aside, not deleted, and come back with one click.",
    again: "Open as usual",
  },
} as const

export function BrokeCard({
  engine,
  broke,
  onOpen,
}: {
  engine: Engine
  broke: Broke
  /** Opens the window, as it is now in the engine. */
  onOpen: () => void
}) {
  const { busy, problem, act } = useAct()
  const title = useId()
  const text = TEXT[broke.what]
  // After the page broke, opening again comes first; after the starts
  // did, opening without the workspaces does.
  const page = broke.what === "page"
  const again = (
    <Button
      key="again"
      variant={page ? "default" : "secondary"}
      disabled={busy}
      onClick={onOpen}
    >
      {text.again}
    </Button>
  )
  const without = (
    <Button
      key="without"
      variant={page ? "secondary" : "default"}
      disabled={busy}
      onClick={async () => {
        if (await act(() => engine.command("workspaces.set_aside", {})))
          onOpen()
      }}
    >
      Open without the workspaces
    </Button>
  )
  return (
    <main className="grid h-dvh place-items-center p-6">
      <section
        aria-labelledby={title}
        className="flex w-full max-w-md flex-col gap-2 rounded-card border bg-popover p-5 text-popover-foreground shadow-lg"
      >
        {page && (
          <BandaMark
            variant="agent"
            state="failed"
            playful={0}
            className="size-5"
          />
        )}
        <h1 id={title} className="text-title font-semibold">
          {text.title}
        </h1>
        <p className="text-ui text-muted-foreground">{text.body}</p>
        {page && (
          <p className="truncate rounded-control bg-muted px-2 py-1.5 font-mono text-meta text-muted-foreground">
            {broke.said}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {page ? [again, without] : [without, again]}
        </div>
        {problem && (
          <p role="alert" className="text-meta text-destructive">
            {problem}
          </p>
        )}
      </section>
    </main>
  )
}
