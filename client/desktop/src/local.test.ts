/**
 * scripts/local.sh, which starts a checkout's window in a systemd unit of
 * its own (ADR 0086, decision 7): the command it runs, with an Electron and
 * a systemd that only say how they were run.
 */
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const local = resolve(import.meta.dirname, "../../../scripts/local.sh")

/** A program that prints its name and its args, a line each. */
const says = (name: string) => `#!/bin/sh\nprintf '%s\\n' ${name} "$@"\n`

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A checkout whose Electron is the script `electron`, beside a user
 * systemd of `version`, or none; the environment local.sh runs in there. */
function checkout(electron: string, version?: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "banda-local-")))
  made.push(dir)
  const bin = join(dir, "bin")
  mkdirSync(bin)
  mkdirSync(join(dir, "node_modules/electron"), { recursive: true })
  writeFileSync(join(dir, "electron"), electron, { mode: 0o755 })
  writeFileSync(
    join(dir, "node_modules/electron/index.js"),
    `module.exports = ${JSON.stringify(join(dir, "electron"))}\n`
  )
  writeFileSync(join(bin, "systemd-run"), says("systemd-run"), { mode: 0o755 })
  writeFileSync(
    join(bin, "systemctl"),
    version ? `#!/bin/sh\necho ${version}\n` : "#!/bin/sh\nexit 1\n",
    { mode: 0o755 }
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
  }
  delete env.BANDA_LOCAL_PARENT
  return { dir, env }
}

/** Runs local.sh with `args` in a checkout whose Electron says how it ran,
 * beside a user systemd of `version`, or none; the words of what ran. */
function run(args: string[], version?: string): string[] {
  const { dir, env } = checkout(says("electron"), version)
  const ran = spawnSync(local, args, { cwd: dir, env, encoding: "utf8" })
  expect(ran.stderr).toBe("")
  expect(ran.status).toBe(0)
  return ran.stdout
    .trimEnd()
    .split("\n")
    .map((word) => word.replaceAll(dir, "<checkout>"))
}

describe("a checkout's window", () => {
  it("runs in a unit of the user's systemd, named when asked", () => {
    expect(
      run(["--unit", "banda-trial-x", ".", "--mute-audio"], "262.1-1-arch")
    ).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--unit=banda-trial-x",
      "--description=Banda Local from <checkout>",
      "--property=TimeoutStopSec=5",
      "--property=OOMPolicy=continue",
      "--",
      "<checkout>/electron",
      ".",
      "--mute-audio",
    ])
  })

  it("runs unnamed, and without OOMPolicy before systemd 253, whose systemd scopes refuse it", () => {
    const words = run(["."], "252")
    expect(words.slice(0, 3)).toEqual(["systemd-run", "--user", "--scope"])
    expect(words.filter((word) => word.startsWith("--unit"))).toEqual([])
    expect(words).not.toContain("--property=OOMPolicy=continue")
    expect(words.slice(-3)).toEqual(["--", "<checkout>/electron", "."])
  })

  it("runs as Electron alone where no systemd of the user's answers", () => {
    expect(run(["--unit", "banda-trial-x", ".", "--mute-audio"])).toEqual([
      "electron",
      ".",
      "--mute-audio",
    ])
  })

  it("closes once the process it watches has gone, as main, with no watch left in its environment", async () => {
    // An Electron that says its pid and what it was told to watch, and
    // runs until SIGTERM.
    const { dir, env } = checkout(
      [
        "#!/bin/sh",
        `trap 'echo closed; exit 0' TERM`,
        `echo "runs $$ \${BANDA_LOCAL_PARENT:-}"`,
        "while :; do sleep 0.1; done",
        "",
      ].join("\n")
    )
    const runner = spawn("sleep", ["30"])
    const window = spawn(local, ["."], {
      cwd: dir,
      env: { ...env, BANDA_LOCAL_PARENT: String(runner.pid) },
    })
    let said = ""
    window.stdout.on("data", (chunk) => (said += chunk))
    const closed = once(window, "exit")
    try {
      await expect.poll(() => said, { timeout: 5000 }).toMatch(/^runs /)
      expect(said.trim()).toBe(`runs ${window.pid}`)
      runner.kill()
      expect(await closed).toEqual([0, null])
      expect(said).toContain("closed")
    } finally {
      runner.kill()
      window.kill("SIGKILL")
    }
  })
})
