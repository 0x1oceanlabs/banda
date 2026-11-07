/**
 * scripts/local.sh, which starts a checkout's window in a systemd unit of
 * its own (ADR 0086, decision 7): the command it runs, with an Electron and
 * a systemd that only say how they were run.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const local = resolve(import.meta.dirname, "../../../scripts/local.sh")

/** A program that prints its name and its args, a line each. */
const says = (name: string) => `#!/bin/sh\nprintf '%s\\n' ${name} "$@"\n`

/** Runs local.sh with `args` in a checkout whose Electron says how it ran,
 * beside a user systemd of `version`, or none; the words of what ran. */
function run(args: string[], version?: string): string[] {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), "banda-local-")))
  const bin = join(checkout, "bin")
  mkdirSync(bin)
  mkdirSync(join(checkout, "node_modules/electron"), { recursive: true })
  writeFileSync(join(checkout, "electron"), says("electron"), { mode: 0o755 })
  writeFileSync(
    join(checkout, "node_modules/electron/index.js"),
    `module.exports = ${JSON.stringify(join(checkout, "electron"))}\n`
  )
  writeFileSync(join(bin, "systemd-run"), says("systemd-run"), { mode: 0o755 })
  writeFileSync(
    join(bin, "systemctl"),
    version ? `#!/bin/sh\necho ${version}\n` : "#!/bin/sh\nexit 1\n",
    { mode: 0o755 }
  )
  const ran = spawnSync(local, args, {
    cwd: checkout,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  })
  expect(ran.stderr).toBe("")
  expect(ran.status).toBe(0)
  return ran.stdout
    .trimEnd()
    .split("\n")
    .map((word) => word.replaceAll(checkout, "<checkout>"))
}

describe("a checkout's window", () => {
  it.runIf(process.platform === "linux")(
    "runs in a scope of the user's systemd, named when asked",
    () => {
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
    }
  )

  it.runIf(process.platform === "linux")(
    "runs unnamed, and without OOMPolicy before systemd 253, whose scopes refuse it",
    () => {
      const words = run(["."], "252")
      expect(words.slice(0, 3)).toEqual(["systemd-run", "--user", "--scope"])
      expect(words.filter((word) => word.startsWith("--unit"))).toEqual([])
      expect(words).not.toContain("--property=OOMPolicy=continue")
      expect(words.slice(-3)).toEqual(["--", "<checkout>/electron", "."])
    }
  )

  it("runs as Electron alone where no systemd of the user's answers", () => {
    expect(run(["--unit", "banda-trial-x", ".", "--mute-audio"])).toEqual([
      "electron",
      ".",
      "--mute-audio",
    ])
  })
})
