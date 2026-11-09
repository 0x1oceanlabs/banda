/**
 * One core and one React across the packages (ADR 0089): what the Window
 * gives through `@banda/core/react` is what an App's part reads, by the
 * path its own package takes to it, and an App's widget draws on the
 * page's React. Two copies of the core would leave an App the defaults, no
 * run, Here nowhere and no machines but its own; two of React would throw
 * at an App's first hook. So with the kit, which gives the Apps what they
 * list, as the Window keeps it, until B7a: two copies would leave a
 * Thread's header no Mark. The tests that draw go by the paths of a few
 * packages; the last goes by every package's, so a second copy fails by
 * the name of the package that reaches it.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type * as CoreReact from "@banda/core/react"
import {
  type Here,
  type Machine,
  MachinesContext,
  type Run,
  Store,
} from "@banda/core/react"
import { ThreadMark } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import type { Filler } from "@banda/ui/slots"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import pageConfig from "../vite.config"
import { newStores } from "./calls/stores"
import { widgets } from "./registry"
import { Kept } from "./window/here"

const root = join(import.meta.dirname, "../../..")

/** What `specifier` gives, as the package in `folder` imports it. */
async function asIn(folder: string, specifier: string) {
  const resolve = createRequire(join(root, folder, "package.json")).resolve
  return (await import(resolve(specifier))) as typeof CoreReact
}

const here = new Store<Here>({
  front: true,
  sidebar: true,
  workspace: { id: "w1", project: "p1" },
  pane: { id: "pane1", project: "p1", subject: "t1" },
  project: "p1",
})

test("an App's part reads the run and Here the Window gives, by the path its package takes to them", async () => {
  // As the servers' widget and the bell take the run, and the Threads'
  // tests Here: from `@banda/core/react`, by their own packages' paths.
  const servers = await asIn("apps/terminal/pane", "@banda/core/react")
  const bell = await asIn("platform/notifications/pane", "@banda/core/react")
  const threads = await asIn("apps/agents/pane", "@banda/core/react")
  const ran: string[] = []
  const run: Run = (action) => void ran.push(action)
  function Reads() {
    servers.useRun()("servers.ran")
    bell.useRun()("bell.ran")
    return <>{threads.useHere((h) => h.pane?.subject)}</>
  }
  expect(
    renderToStaticMarkup(
      <Kept stores={newStores()} here={here} run={run}>
        <Reads />
      </Kept>
    )
  ).toBe("t1")
  expect(ran).toEqual(["servers.ran", "bell.ran"])
})

test("an App's widget draws on the page's React, under the Window's", () => {
  const ports = widgets.get("terminal.ports")
  expect(ports).toBeDefined()
  const { Widget } = ports!.widget
  // With no Project it draws nothing, past its hooks.
  const engine = {} as Engine
  expect(
    renderToStaticMarkup(
      <Kept stores={newStores()} here={here} run={() => undefined}>
        <Widget engine={engine} projects={[]} />
      </Kept>
    )
  ).toBe("")
})

test("a new Thread's picker lists the machines the Window gives, by the path its package takes to them", async () => {
  // As `App.tsx` gives them, from the page's `@banda/core/react`; the
  // picker reads them from the Threads package's.
  const { NewThreadBar } = (await import(
    join(root, "apps/agents/pane/src/composer/NewThread.tsx")
  )) as {
    NewThreadBar: (props: {
      engine: Engine
      project: ProjectId
      host: string | undefined
      disabled: boolean
      onProject: () => void
    }) => ReactNode
  }
  const project = (id: string): ProjectSummary => ({
    id: id as ProjectId,
    name: id,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: id[0]!.toUpperCase(), picked: false },
    trusted: true,
    scratch: false,
    missing: false,
  })
  const machines: Machine[] = [
    { machine: "m0" as ProjectId, state: "live", projects: [project("work")] },
    {
      host: "arc",
      named: { name: "Studio", icon: "server" },
      machine: "m1" as ProjectId,
      state: "live",
      projects: [project("r1")],
    },
  ]
  // A Pane on arc, which its engine has not welcomed yet: the picker names
  // the machine as the Window does, not by its key.
  const drawn = renderToStaticMarkup(
    <MachinesContext value={machines}>
      <NewThreadBar
        engine={{} as Engine}
        project={"r1" as ProjectId}
        host="arc"
        disabled={false}
        onProject={() => undefined}
      />
    </MachinesContext>
  )
  expect(drawn).toContain("on Studio")
  expect(drawn).not.toContain("on arc")
})

test("Threads' part of a Pane's header finds its Thread among what the Apps list, as the Window gives it, by the path its package takes to the kit", async () => {
  // As the Tiling draws the Slot `pane.header` under the Window's `Kept`;
  // the filler reads the items from the Threads package's kit.
  const { threadHeader } = (await import(
    join(root, "apps/agents/pane/src/list/header.tsx")
  )) as { threadHeader: Filler<"pane.header"> }
  const { Fill } = threadHeader
  const listed: Listed = {
    id: "t1",
    title: "Hello",
    mark: "done",
    changed: 1,
    pane: { kind: "agents.thread", args: { thread: "t1" } },
  }
  const stores = newStores()
  stores.items.set({ ["p1" as ProjectId]: [listed] })
  const markup = (node: ReactNode) =>
    renderToStaticMarkup(node).replace(/banda-mark-[\w-]+/g, "banda-mark-id")
  expect(
    markup(
      <Kept stores={stores} here={here} run={() => undefined}>
        <Fill project={"p1" as ProjectId} pane={listed.pane} at="start" />
      </Kept>
    )
  ).toBe(markup(<ThreadMark listed={listed} />))
})

/**
 * The folder of each package of the workspace, from the root: those
 * `pnpm-workspace.yaml` lists that have a `package.json`. Its globs are
 * folders and `*`; another kind throws, so a package listed some new way
 * is not left unread.
 */
function workspacePackages(): string[] {
  const listed = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")
  const block = /^packages:\n((?:[ \t].*\n|\n)*)/m.exec(listed)?.[1] ?? ""
  const globs = [...block.matchAll(/^\s*-\s*["']?([^"'\s]+)/gm)].map(
    (match) => match[1]!
  )
  return globs
    .flatMap((glob) => {
      if (!/^(\*|[\w.-]+)(\/(\*|[\w.-]+))*$/.test(glob))
        throw new Error(
          `pnpm-workspace.yaml lists ${glob}, read here as no glob`
        )
      return glob.split("/").reduce<string[]>(
        (found, part) =>
          found.flatMap((folder) => {
            if (part !== "*") return [join(folder, part)]
            const at = join(root, folder)
            if (!existsSync(at)) return []
            return readdirSync(at, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => join(folder, entry.name))
          }),
        [""]
      )
    })
    .filter((folder) => existsSync(join(root, folder, "package.json")))
}

/**
 * What must be one copy for the whole page, each by an entry that every
 * package taking it reaches: the kit by the Item, which a second copy
 * loses first (the kit does not give its `./package.json`).
 */
const ONE_COPY = {
  "@banda/ui": "@banda/ui/hooks/use-item",
  "@banda/core": "@banda/core/react",
  react: "react",
  "react-dom": "react-dom",
} as const
type OneCopy = keyof typeof ONE_COPY

test("every package that takes the kit, the core or React reaches one copy of each", () => {
  const where = (path: string) => relative(root, realpathSync(path))
  // A package that reaches none, as a node_modules installed before it
  // took one can leave it, is said by its name, not by a bare error.
  const reached = (resolve: NodeJS.RequireResolve, specifier: string) => {
    try {
      return where(resolve(specifier))
    } catch {
      return "none"
    }
  }
  // The one copy: the workspace's own kit and core, and the page's React.
  const page = createRequire(join(root, "client/web/package.json")).resolve
  const copy: Record<OneCopy, string> = {
    "@banda/ui": where(join(root, "client/ui/src/hooks/use-item.ts")),
    "@banda/core": where(join(root, "client/core/src/react/index.ts")),
    react: where(page("react")),
    "react-dom": where(page("react-dom")),
  }
  const taking = new Set<string>()
  const ranged: string[] = []
  const strays: string[] = []
  for (const folder of workspacePackages()) {
    const manifest = JSON.parse(
      readFileSync(join(root, folder, "package.json"), "utf8")
    ) as Partial<Record<string, Record<string, string>>>
    const taken = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ].flatMap((list) => Object.entries(manifest[list] ?? {}))
    // pnpm links the workspace's own package for a `workspace:` range,
    // which every package writes `workspace:*`; another kind of range it
    // looks for in the registry, a copy of its own with a kit of its own.
    for (const [name, range] of taken)
      if (name.startsWith("@banda/") && range !== "workspace:*")
        ranged.push(`${folder}: ${name} ${range}`)
    const resolve = createRequire(join(root, folder, "package.json")).resolve
    for (const name of Object.keys(ONE_COPY) as OneCopy[]) {
      if (!taken.some(([listed]) => listed === name)) continue
      taking.add(folder)
      const path = reached(resolve, ONE_COPY[name])
      if (path !== copy[name]) strays.push(`${folder}: ${name} → ${path}`)
    }
  }
  // The package whose header is at stake is among them, so a list read
  // wrong cannot pass by checking nothing.
  expect(taking).toContain("apps/agents/pane")
  expect(ranged, "the workspace's packages by `workspace:*`").toEqual([])
  expect(strays, `one copy of each: ${Object.values(copy).join(", ")}`).toEqual(
    []
  )
  // Nor does the page's bundler send them elsewhere, as an alias would,
  // whatever the packages reach.
  const aliases = pageConfig.resolve?.alias ?? []
  const finds = Array.isArray(aliases)
    ? aliases.map(({ find }) => find)
    : Object.keys(aliases)
  const packageOf = (specifier: string) =>
    specifier
      .split("/")
      .slice(0, specifier.startsWith("@") ? 2 : 1)
      .join("/")
  // A pattern counts when it takes a package's name or entry, or names
  // the package in its source, as one for a deeper path of the kit does.
  const aliased = finds.filter((find) =>
    typeof find === "string"
      ? packageOf(find) in ONE_COPY
      : Object.entries(ONE_COPY).some(
          ([name, entry]) =>
            find.test(name) ||
            find.test(entry) ||
            new RegExp(`(^|[^\\w@/.-])${name}($|[^\\w.-])`).test(
              find.source.replaceAll("\\/", "/")
            )
        )
  )
  expect(aliased, "the page's aliases").toEqual([])
})
