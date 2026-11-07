/**
 * The old way to a Stable is closed (ADR 0092, step 2): no workflow here
 * starts on a tag, devbox fails a tag's jobs, which an older commit's
 * release.yml still starts, and no tag changes a Dev's number. The release
 * workflow packs and publishes only Banda Dev, and `scripts/promote.mjs`,
 * which pushed that tag, refuses until Banda is promoted from a Dev once a
 * day (its step 6).
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, test } from "vitest"

const root = resolve(import.meta.dirname, "../../..")
const text = (path: string) => readFileSync(resolve(root, path), "utf8")

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true })
})
/** A folder of the test's own, gone after it. */
function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `banda-${name}-`))
  made.push(dir)
  return dir
}

/** A workflow's triggers, each with the lines just under it: as much of
 * YAML as the `on:` blocks of these workflows need. */
function triggers(name: string): Map<string, string[]> {
  const lines = text(`.github/workflows/${name}`).split("\n")
  const start = lines.indexOf("on:")
  if (start < 0) throw new Error(`${name}: its triggers are no \`on:\` block`)
  const found = new Map<string, string[]>()
  let under: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break
    const trigger = /^ {2}([\w-]+):/.exec(line)?.[1]
    if (trigger) found.set(trigger, (under = []))
    else if (/^ {4}[^\s#]/.test(line)) under.push(line.trim())
  }
  return found
}

test("no workflow starts on a tag", () => {
  const workflows = readdirSync(resolve(root, ".github/workflows")).filter(
    (name) => /\.ya?ml$/.test(name)
  )
  expect(workflows).toContain("release.yml")
  for (const name of workflows) {
    const on = triggers(name)
    expect([...on.keys()], name).not.toContain("create")
    // A push with no branches named starts on every tag too.
    const push = on.get("push") ?? []
    expect(
      push.filter((line) => /^tags(-ignore)?:/.test(line)),
      `${name}: tags its push starts on`
    ).toEqual([])
    expect(
      !on.has("push") || push.some((line) => /^branches(-ignore)?:/.test(line)),
      `${name}: its push names its branches`
    ).toBe(true)
  }
})

test("the release workflow packs only Banda Dev, numbered with no tag read", () => {
  const workflow = text(".github/workflows/release.yml")
  expect(workflow.match(/\bchannel=\w+/g)).toEqual(["channel=dev"])
  expect(workflow).not.toMatch(
    /\bgit (tag|describe)\b|GITHUB_REF_NAME|github\.ref_name|refs\/tags|fetch-tags/
  )
})

test("devbox fails a tag's jobs, and still runs a branch's", () => {
  const event = join(scratch("job-started"), "event.json")
  writeFileSync(event, "{}")
  const run = (ref: string) =>
    spawnSync("bash", [resolve(root, "ci/job-started.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: ref,
        GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: "0x1oceanlabs/banda",
      },
    })
  const tag = run("refs/tags/v0.1.0")
  expect(tag.status).toBe(1)
  expect(tag.stdout).toContain("ADR 0092, step 2")
  expect(run("refs/heads/main").status).toBe(0)
})

test("release.mjs publishes no Stable", () => {
  const ran = spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/release.mjs"),
      "stable",
      "0.2.0",
      "0".repeat(40),
      "banda-0.2.0-x86_64.AppImage",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "", GITHUB_TOKEN: "" },
    }
  )
  expect(ran.status).toBe(1)
  expect(ran.stderr).toContain("release.mjs dev <version> <commit> <files…>")
})

test("promote.mjs refuses, names ADR 0092, and runs neither gh nor git", () => {
  const bin = scratch("promote")
  const used = join(bin, "used")
  for (const tool of ["gh", "git"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho ${tool} >> '${used}'\n`, {
      mode: 0o755,
    })
  }
  for (const args of [[], ["0.761.0"], ["--yes", "dev.120"]]) {
    const ran = spawnSync(
      process.execPath,
      [resolve(root, "scripts/promote.mjs"), ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }
    )
    expect(ran.status, args.join(" ")).toBe(1)
    expect(ran.stdout).toBe("")
    expect(ran.stderr).toContain("ADR 0092, step 2")
    expect(ran.stderr).toContain(
      "docs/adr/0092-every-merge-is-a-banda-dev-banda-is-promoted-from-it-once-a-day-and-one-number-names-both.md"
    )
  }
  expect(existsSync(used)).toBe(false)
})
