// Makes a Dev that Roma has lived with the next Stable (ADR 0033,
// decision 4), from Roma's own checkout:
//
//   node scripts/promote.mjs            the last Dev
//   node scripts/promote.mjs dev.120    that Dev (or 120, or 0.1.0-dev.120)
//   node scripts/promote.mjs --yes …    without asking
//
// Dev 0.X.Y-dev.N becomes Stable 0.X.Y: its tag v0.X.Y goes on the commit
// that Dev was built from. Pushed with Roma's gh, not the workflow's
// token, so the tag starts the release workflow, which builds Stable from
// that commit. A fix to a Stable is a branch from its tag and a tag
// v0.X.Y+1 on it, pushed by hand: `which` takes any tag.
import { execFileSync } from "node:child_process"
import { createInterface } from "node:readline/promises"

const REPO = "0x1oceanlabs/banda"
const args = process.argv.slice(2)
const yes = args.includes("--yes")
const asked = args.find((arg) => arg !== "--yes")

const gh = (...rest) =>
  JSON.parse(
    execFileSync("gh", ["api", ...rest], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  )

const devs = gh(`repos/${REPO}/releases?per_page=100`).filter(
  (r) => r.prerelease && !r.draft && r.tag_name.includes("-dev.")
)
const number = asked && /(\d+)$/.exec(asked)?.[1]
const dev = number
  ? devs.find((r) => r.tag_name.endsWith(`-dev.${number}`))
  : devs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
if (!dev) {
  // Only the last 20 Devs are kept (release.mjs).
  throw new Error(
    `No Dev ${asked ?? ""} among the releases: ${devs.map((r) => r.tag_name).join(", ")}`
  )
}
const commit = dev.target_commitish
const tag = dev.tag_name.replace(/-dev\.\d+$/, "")
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`${dev.tag_name} names no commit: ${commit}`)
}
let taken = true
try {
  gh(`repos/${REPO}/git/ref/tags/${tag}`)
} catch {
  taken = false
}
if (taken) throw new Error(`${tag} is out already: a fix is v0.X.Y+1, by hand.`)

console.log(`${dev.name} → Banda ${tag.slice(1)}`)
console.log(`  ${dev.body}`)
console.log(`  ${dev.html_url}`)
if (!yes) {
  const line = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await line.question(
    `Tag ${tag} on ${commit.slice(0, 7)}? [y/N] `
  )
  line.close()
  if (answer.trim().toLowerCase() !== "y") process.exit(1)
}
gh(
  `repos/${REPO}/git/refs`,
  "-f",
  `ref=refs/tags/${tag}`,
  "-f",
  `sha=${commit}`
)
console.log(
  `${tag} is tagged: the release workflow builds it, https://github.com/${REPO}/actions/workflows/release.yml`
)
