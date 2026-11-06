import { describe, expect, test } from "vitest"
import type { ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Action, MenuAct, MenuRow } from "@banda/ui/module"
import type { Shell } from "../shell/actions"
import {
  actsOf,
  branchName,
  type Branch,
  type Choice,
  type Found,
  isBranch,
  menuOf,
  openingOf,
  ranked,
  settingsLinkOf,
  type Sources,
} from "./menu"

const thread = (id: string, title: string, more: Partial<Listed> = {}) =>
  ({
    id,
    title,
    mark: "idle",
    changed: 0,
    pane: { kind: "agents.thread", args: { thread: id } },
    ...more,
  }) as Listed

const lists = {
  s1: [
    thread("t1", "Fix the login form", { changed: 1, said: "the button" }),
    thread("t2", "hello from claude", { changed: 3 }),
    thread("t3", "slow hello", { changed: 2, mark: "done" }),
  ],
}
const projects = [
  { id: "s1", name: "banda", folder: "/home/r/banda" },
] as unknown as ProjectSummary[]
const action = (
  id: string,
  title: string,
  section = "Banda"
): Action<Shell> => ({ id, title, section, run: () => {} })
const actions = [
  action("thread.new", "New Thread", "Threads"),
  action("browser.new", "New browser", "Panes"),
  action("sidebar.toggle", "Show or hide the sidebar", "Threads"),
]

const sources: Sources = {
  lists,
  projects,
  actions,
  presets: { names: ["inbox", "projects", "places"], current: "inbox" },
  archived: (listed) => listed.id === "t3",
  asleep: () => false,
  found: [],
  weight: () => 0,
}

const row = (id: string, title: string, acts?: MenuAct[]): MenuRow => ({
  id,
  title,
  run: () => {},
  acts,
})

/** What the modules' sources find, as they would: files under their
 * heading, then New Thread and the web with none. */
const foundFor = (words: string, entered?: string): Found[] => [
  { id: "files.find", label: "Files", rows: [] },
  {
    id: "agents.ask",
    label: "",
    rows:
      words || entered
        ? [
            row(
              entered ? `agents.ask.${entered}` : "agents.ask",
              words ? `ask: ${words}` : "ask here",
              [
                { title: "Start on Claude Code", run: () => {} },
                { title: "Start on Codex", run: () => {} },
              ]
            ),
          ]
        : [],
  },
  {
    id: "browser.web",
    label: "",
    rows: words && !entered ? [row("browser.web", `web: ${words}`)] : [],
  },
]

function nameOf(row: Choice): string {
  switch (row.kind) {
    case "thread":
      return row.listed.title
    case "project":
      return row.project.name
    case "views":
      return "Sidebar view"
    case "action":
      return row.action.title
    case "ask":
      return ["ask:", row.words, row.project && `in ${row.project}`]
        .filter(Boolean)
        .join(" ")
    case "preset":
      return row.current ? `${row.name} ✓` : row.name
    case "archive":
      return `archive ${row.listed.id}`
    case "snooze":
    case "wake":
      return `${row.kind} ${row.listed.id}`
    case "found":
      return row.row.title
    case "family":
      return `${row.title} ›`
    case "bind":
      return `bind ${row.action.id}`
    case "free":
      return `free ${row.action.id}`
    case "add":
    case "source":
    case "locate":
    case "finds":
      return branchName(row)
    case "adding":
      return "name" in row.how
        ? `create ${row.how.name}`
        : "locate" in row.how
          ? `locate ${row.how.folder}`
          : `${row.how.create ? "create & add" : "add"} ${row.how.folder}`
    case "folder":
      return row.up ? `.. ${row.path}` : row.path
  }
}

/** The menu's sources for `words`, with what the modules find. */
const sourcesFor = (
  words: string,
  inside?: Branch,
  more: Partial<Sources> = {}
): Sources => ({
  ...sources,
  found: foundFor(
    words,
    inside?.kind === "project" ? inside.project.id : undefined
  ),
  ...more,
})

const menuFor = (
  words: string,
  at: "root" | "actions" = "root",
  inside?: Branch,
  more: Partial<Sources> = {}
) => menuOf({ words, at, inside, sources: sourcesFor(words, inside, more) })

const labels = (...args: Parameters<typeof menuFor>) =>
  menuFor(...args).map((group) => [group.label, group.rows.map(nameOf)])

describe("the Banda menu", () => {
  test("empty, it shows the Recent Threads, what waits first, and Actions", () => {
    expect(labels("")).toEqual([
      [
        "Recent Threads",
        ["slow hello", "hello from claude", "Fix the login form"],
      ],
      ["Actions", ["New Thread", "New browser"]],
    ])
  })

  test("typed into, it finds Threads, Projects and Actions, then what the sources find with no heading", () => {
    expect(labels("hello")).toEqual([
      ["Threads", ["hello from claude", "slow hello"]],
      ["", ["ask: hello", "web: hello"]],
    ])
    expect(labels("ban")).toEqual([
      ["Projects", ["banda"]],
      ["", ["ask: ban", "web: ban"]],
    ])
    expect(labels("new")).toEqual([
      ["Actions", ["New Thread", "New browser"]],
      ["", ["ask: new", "web: new"]],
    ])
  })

  test("a source's rows go under its heading, between the Projects and the Actions; Tab lists their acts", () => {
    const open = { title: "Open", key: { code: "Enter" }, run: () => {} }
    const copy = { title: "Copy path", run: () => {} }
    const found: Found[] = [
      {
        id: "agents.file",
        label: "Files",
        rows: [row("agents.file.s1.src/new.ts", "new.ts", [open, copy])],
      },
      { id: "other.file", label: "Files", rows: [row("other.file.a", "a")] },
      { id: "agents.ask", label: "", rows: [row("agents.ask", "ask: new")] },
    ]
    expect(labels("new", "root", undefined, { found })).toEqual([
      ["Files", ["new.ts", "a"]],
      ["Actions", ["New Thread", "New browser"]],
      ["", ["ask: new"]],
    ])
    const file = menuFor("new", "root", undefined, { found })[0].rows[0]
    expect(actsOf(file, sources).map((act) => act.title)).toEqual([
      "Open",
      "Copy path",
    ])
    expect(actsOf(file, sources)[0].key).toEqual({ code: "Enter" })
  })

  test("an action run by its id alone is not listed", () => {
    const opens = {
      ...action("browser.open", "Open in a browser"),
      unlisted: true as const,
    }
    const more = { actions: [...actions, opens] }
    expect(labels("open", "root", undefined, more)).toEqual([
      ["", ["ask: open", "web: open"]],
    ])
    expect(
      labels("", "actions", undefined, more).flatMap(([, rows]) => rows)
    ).not.toContain("Open in a browser")
  })

  test("what is chosen often and lately ranks first among equals, and leads the empty Actions", () => {
    const weight = (id: string) =>
      ({ "action:browser.new": 4, "action:sidebar.toggle": 1 })[id] ?? 0
    expect(labels("new", "root", undefined, { weight })[0]).toEqual([
      "Actions",
      ["New browser", "New Thread"],
    ])
    expect(labels("", "root", undefined, { weight }).at(-1)).toEqual([
      "Actions",
      ["New browser", "Show or hide the sidebar", "New Thread"],
    ])
  })

  test("a Thread is found by what it was asked too", () => {
    expect(labels("button")[0]).toEqual(["Threads", ["Fix the login form"]])
  })

  test("opened at its Actions, it is the key sheet: every action by section, and no more", () => {
    expect(labels("", "actions")).toEqual([
      ["Threads", ["New Thread", "Show or hide the sidebar", "Sidebar view"]],
      ["Panes", ["New browser"]],
      ["Banda", ["Add Project"]],
    ])
    expect(labels("side", "actions")).toEqual([
      ["Actions", ["Sidebar view", "Show or hide the sidebar"]],
    ])
  })

  test("the key sheet folds a family into one row, which it goes into; a search finds each", () => {
    const go = (n: number): Action<Shell> => ({
      ...action(`workspace.go-${n}`, `Go to workspace ${n}`, "Workspaces"),
      family: "Go to a workspace",
    })
    const more = { actions: [...actions, go(1), go(2), go(3)] }
    expect(labels("", "actions", undefined, more).at(-2)).toEqual([
      "Workspaces",
      ["Go to a workspace ›"],
    ])
    const family = menuOf({
      words: "",
      at: "actions",
      sources: { ...sources, ...more },
    })
      .flatMap((group) => group.rows)
      .find((row) => row.kind === "family")
    expect(family && isBranch(family)).toBe(true)
    expect(labels("", "actions", family as Branch, more)).toEqual([
      ["", ["Go to workspace 1", "Go to workspace 2", "Go to workspace 3"]],
    ])
    expect(labels("workspace 2", "actions", undefined, more)).toEqual([
      ["Actions", ["Go to workspace 2"]],
    ])
  })

  test("Tab on an action runs it, binds it a key, or frees one of its keys", () => {
    const row: Choice = {
      kind: "action",
      id: "action:menu.keys",
      action: {
        ...action("menu.keys", "Every action and its key"),
        keys: [{ code: "KeyK", alt: true }],
      },
    }
    expect(
      actsOf(row, sources).map((act) => [act.title, act.row.kind])
    ).toEqual([
      ["Run", "action"],
      ["Add a key…", "bind"],
      ["Free Alt+K", "free"],
    ])
  })

  test("its rows run in the order the list shows", () => {
    const groups = menuFor("hello")
    expect(groups.flatMap((g) => g.rows).map((row) => row.id)).toEqual([
      "thread:s1:t2",
      "thread:s1:t3",
      "agents.ask",
      "browser.web",
    ])
  })
})

describe("its branches and acts", () => {
  const project: Branch = {
    kind: "project",
    id: "project:s1",
    project: projects[0],
  }
  test("a Project holds a new Thread there, then its Threads", () => {
    expect(labels("", "root", project)).toEqual([
      ["", ["ask here"]],
      ["Threads", ["slow hello", "hello from claude", "Fix the login form"]],
    ])
    expect(labels("form", "root", project)).toEqual([
      ["", ["ask: form"]],
      ["Threads", ["Fix the login form"]],
    ])
  })

  test("Tab on a Project opens it, or starts a new Thread there", () => {
    expect(
      actsOf(project, sources).map((act) => [act.title, nameOf(act.row)])
    ).toEqual([
      ["Open", "banda"],
      ["New Thread here", "ask: in s1"],
    ])
  })

  test("the sidebar's view holds its presets, the one in force ticked", () => {
    expect(labels("view")[0]).toEqual(["Actions", ["Sidebar view"]])
    const views: Branch = { kind: "views", id: "views" }
    expect(labels("", "root", views)).toEqual([
      ["", ["inbox ✓", "projects", "places"]],
    ])
  })

  test("Tab on a Thread opens it, beside, snoozes or archives it", () => {
    const [t3, t2] = menuOf({ words: "", at: "root", sources })[0].rows
    expect(actsOf(t2, sources).map((act) => act.title)).toEqual([
      "Open",
      "Open beside",
      "Snooze…",
      "Archive thread",
    ])
    expect(actsOf(t3, sources).at(-1)?.title).toBe("Unarchive thread")
    const asleep = {
      ...sources,
      asleep: (listed: Listed) => listed.id === "t2",
    }
    expect(actsOf(t2, asleep)[2].title, "one that sleeps").toBe("Wake now")
  })

  test("Tab on New Thread lists what its source says: each Harness", () => {
    const ask = menuFor("x").at(-1)!.rows[0]
    expect(actsOf(ask, sources).map((act) => act.title)).toEqual([
      "Start on Claude Code",
      "Start on Codex",
    ])
  })
})

describe("Add Project (ADR 0026)", () => {
  const add: Branch = { kind: "add", id: "project.add" }
  const way = (source: "new" | "folder"): Branch => ({
    kind: "source",
    id: `project.add.${source}`,
    source,
  })
  const browsed = (
    partial: string,
    parent: string,
    exists: boolean,
    ...names: string[]
  ) => ({
    partial,
    parent,
    exists,
    entries: names.map((name) => ({ name, path: `${parent}/${name}` })),
  })

  test("it is an Action, and lists its ways", () => {
    expect(labels("add pr")).toContainEqual(["Actions", ["Add Project"]])
    expect(labels("", "root", add)).toEqual([
      ["", ["New Project", "Local folder"]],
    ])
    expect(labels("local", "root", add)).toEqual([["", ["Local folder"]]])
  })

  test("a new Project is made from the name typed", () => {
    expect(labels("", "root", way("new"))).toEqual([])
    expect(labels(" Work ", "root", way("new"))).toEqual([
      ["", ["create Work"]],
    ])
  })

  test("a folder is added, or made and added, then the folders that fit, as typed", () => {
    const home = browsed("~/co", "/home/r", false, "code", "colors")
    expect(labels("~/co", "root", way("folder"), { browsed: home })).toEqual([
      ["", ["create & add ~/co", ".. /home/", "~/code/", "~/colors/"]],
    ])
    const deeper = browsed("~/code/a", "/home/r/code", false, "app")
    expect(
      labels("~/code/a", "root", way("folder"), { browsed: deeper })
    ).toEqual([["", ["create & add ~/code/a", ".. ~/", "~/code/app/"]]])
    const there = browsed("/srv/www/", "/srv/www", true)
    expect(
      labels("/srv/www/", "root", way("folder"), { browsed: there })
    ).toEqual([["", ["add /srv/www/", ".. /srv/"]]])
    const root = browsed("/", "/", true)
    expect(labels("/", "root", way("folder"), { browsed: root })).toEqual([
      ["", ["add /"]],
    ])
  })

  test("a missing Project's folder is located from where it was, once the path is a folder", () => {
    const gone = {
      ...projects[0],
      id: "s2",
      name: "old",
      folder: "/home/r/old",
      missing: true,
    }
    expect(labels("ol", "root", undefined, { projects: [gone] })[0]).toEqual([
      "Projects",
      ["Locate folder"],
    ])
    expect(openingOf("project.locate.s2", [gone]).words).toBe("/home/r/")
    const locate: Branch = {
      kind: "locate",
      id: "project.locate.s2",
      project: gone,
    }
    const moved = browsed("/home/r/new", "/home/r", true, "new")
    expect(labels("/home/r/new", "root", locate, { browsed: moved })).toEqual([
      ["", ["locate /home/r/new", ".. /home/", "/home/r/new/"]],
    ])
    const nowhere = browsed("/home/r/nope", "/home/r", false)
    expect(
      labels("/home/r/nope", "root", locate, { browsed: nowhere })
    ).toEqual([["", [".. /home/"]]])
  })

  test("a path not yet read is added, not made", () => {
    const before = browsed("~/c", "/home/r", false, "code")
    expect(
      labels("~/co", "root", way("folder"), { browsed: before })[0][1][0]
    ).toBe("add ~/co")
  })
})

describe("ranking", () => {
  const titles = ["a slow hello", "hello world", "hello", "say hellos", "help"]
  test("the text itself, then its start, then a word's start, then every word in it", () => {
    expect(ranked(titles, "hello", (t) => [t])).toEqual([
      "hello",
      "hello world",
      "a slow hello",
      "say hellos",
    ])
    expect(ranked(titles, "slow hel", (t) => [t])).toEqual(["a slow hello"])
  })
  test("among equal matches the one that weighs more comes first", () => {
    expect(
      ranked(
        ["hello a", "hello b"],
        "hello",
        (t) => [t],
        (t) => (t === "hello b" ? 1 : 0)
      )
    ).toEqual(["hello b", "hello a"])
  })
  test("a match in the first text beats one in the second", () => {
    const things = [
      ["other", "login"],
      ["login", ""],
    ]
    expect(ranked(things, "login", (t) => t)).toEqual([
      ["login", ""],
      ["other", "login"],
    ])
  })
})

describe("banda menu ROUTE", () => {
  const where = (route: string) => {
    const { at, path, words } = openingOf(route, projects)
    return [at, path.map((branch) => branch.id), words]
  }
  test("find.<source> shows that source alone, as quick open shows the files", () => {
    const files = { id: "files.find", label: "Files" }
    const { path } = openingOf("find.files.find", projects, [files])
    expect(path).toEqual([
      {
        kind: "finds",
        id: "find.files.find",
        source: "files.find",
        label: "Files",
      },
    ])
    expect(branchName(path[0])).toBe("Files")
    const found: Found[] = [
      { id: "files.find", label: "Files", rows: [row("files.file.a", "a.ts")] },
      { id: "agents.ask", label: "", rows: [row("agents.ask", "ask: a")] },
    ]
    expect(labels("a", "root", path[0], { found })).toEqual([["", ["a.ts"]]])
    // No source by that id: the words are typed.
    expect(where("find.other")).toEqual(["root", [], "find.other"])
  })
  test("opens at the root, the Actions, the sidebar's view or a Project", () => {
    expect(where("")).toEqual(["root", [], ""])
    expect(where("actions")).toEqual(["actions", [], ""])
    expect(where("views")).toEqual(["root", ["views"], ""])
    expect(where("project.Banda")).toEqual(["root", ["project:s1"], ""])
    expect(where("project.s1")).toEqual(["root", ["project:s1"], ""])
  })
  test("project.add opens Add Project, or one of its ways", () => {
    expect(where("project.add")).toEqual(["root", ["project.add"], ""])
    expect(where("project.add.folder")).toEqual([
      "root",
      ["project.add", "project.add.folder"],
      "~/",
    ])
    expect(where("project.add.new")).toEqual([
      "root",
      ["project.add", "project.add.new"],
      "",
    ])
  })
  test("other words, and a Project there is not, are typed in", () => {
    expect(where(" fix the login ")).toEqual(["root", [], "fix the login"])
    expect(where("project.nope")).toEqual(["root", [], "project.nope"])
  })
  test("a settings route is the settings Pane's link, not the menu's", () => {
    expect(settingsLinkOf("settings")).toBe("")
    expect(settingsLinkOf(" settings.agents.codex ")).toBe("agents/codex")
    expect(settingsLinkOf("project.settings")).toBeUndefined()
    expect(settingsLinkOf("fix the settings")).toBeUndefined()
  })
})
