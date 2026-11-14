// Publishes what scripts/package.sh packed as a GitHub release (ADR 0033,
// step 3), for the release workflow:
//
//   node scripts/release.mjs dev <version> <commit> <files…>
//   node scripts/release.mjs add <version> <files…>
//
// A Dev is a prerelease v<version> made at <commit>; only the last 20 Dev
// releases are kept. `add` puts the Mac's or Windows' files on a release
// already out (ADR 0033, decision 6; ADR 0090, step 6), and says
// `added=true` to the workflow.
// GITHUB_TOKEN and GITHUB_REPOSITORY come from the workflow.
//
// It publishes no Stable: a Stable is no longer the release of a tag
// pushed by hand, and Banda will be promoted from a Dev once a day (ADR
// 0092, steps 2 and 6).
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, statSync } from "node:fs"
import { basename } from "node:path"

const KEEP_DEV = 20
const [channel, version, ...files] = process.argv.slice(2)
const adding = channel === "add"
const commit = adding ? "" : files.shift()
if (
  !["dev", "add"].includes(channel) ||
  !version ||
  !(adding || commit) ||
  !files.length
) {
  throw new Error(
    "release.mjs dev <version> <commit> <files…>, or add <version> <files…>"
  )
}
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN")

async function github(method, path, body, base = "https://api.github.com") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body instanceof Buffer
        ? { "content-type": "application/octet-stream" }
        : body && { "content-type": "application/json" }),
    },
    body:
      body instanceof Buffer || body === undefined
        ? body
        : JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw Object.assign(
      new Error(`${method} ${path}: ${response.status} ${text}`),
      {
        status: response.status,
      }
    )
  }
  return response.status === 204 ? undefined : response.json()
}

const tag = `v${version}`
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const releases = await github("GET", `/repos/${repo}/releases?per_page=100`)

async function upload(release, file) {
  const name = basename(file)
  console.log(
    `${tag}: ${name}, ${(statSync(file).size / 2 ** 20).toFixed(0)} MB`
  )
  await github(
    "POST",
    `/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    readFileSync(file),
    "https://uploads.github.com"
  )
}

if (adding) {
  // A Dev the fallback below skipped has no release to add to.
  const release = releases.find((r) => r.tag_name === tag && !r.draft)
  if (!release) {
    console.log(`::warning::${tag} is not out: these files are not added.`)
    process.exit(0)
  }
  // A run again replaces what it added before.
  for (const file of files) {
    const same = release.assets.find((a) => a.name === basename(file))
    if (same)
      await github("DELETE", `/repos/${repo}/releases/assets/${same.id}`)
    await upload(release, file)
  }
  console.log(release.html_url)
  // For the next step, which puts the cask in the tap.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "added=true\n")
  }
  process.exit(0)
}

// A run again (the same run number, so the same tag): a release it left
// as a draft goes; one it published is done.
for (const r of releases.filter((r) => r.tag_name === tag)) {
  if (!r.draft) {
    console.log(`${tag}: already published, ${r.html_url}`)
    process.exit(0)
  }
  await github("DELETE", `/repos/${repo}/releases/${r.id}`)
}

const subject = git("log", "-1", "--format=%s", commit)

// A draft first, so nobody (electron-updater, step 5) sees a release
// without its files; it is published once they are up.
const release = await github("POST", `/repos/${repo}/releases`, {
  tag_name: tag,
  draft: true,
  target_commitish: commit,
  name: `Banda Dev ${version}`,
  body: `Built from ${commit.slice(0, 7)}: ${subject}`,
  prerelease: true,
  make_latest: "false",
})
// A file that fails to go up takes the draft with it: a draft left behind
// only waits for a run again of the same number, which may never come.
try {
  for (const file of files) await upload(release, file)
} catch (error) {
  await github("DELETE", `/repos/${repo}/releases/${release.id}`)
  throw error
}
try {
  const published = await github(
    "PATCH",
    `/repos/${repo}/releases/${release.id}`,
    {
      draft: false,
    }
  )
  console.log(published.html_url)
} catch (error) {
  // A fallback that has not been needed: the workflow's token has tagged
  // Devs whose commit changes a workflow (v0.1.0-dev.390, v0.1.0-dev.400),
  // as such a commit is on main already. Should GitHub refuse one, that Dev
  // is skipped, and the next push to main is the next.
  const workflows = git(
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit
  )
    .split("\n")
    .some((file) => file.startsWith(".github/workflows/"))
  if (!workflows || ![403, 404].includes(error.status)) {
    throw error
  }
  await github("DELETE", `/repos/${repo}/releases/${release.id}`)
  console.log(
    `::warning::${tag} is skipped: its commit changes a workflow, which the workflow's token may not tag.`
  )
  process.exit(0)
}

const old = releases
  .filter((r) => r.prerelease && !r.draft && r.tag_name.includes("-dev."))
  .sort((a, b) => b.created_at.localeCompare(a.created_at))
  .slice(KEEP_DEV - 1)
for (const r of old) {
  await github("DELETE", `/repos/${repo}/releases/${r.id}`)
  await github("DELETE", `/repos/${repo}/git/refs/tags/${r.tag_name}`)
  console.log(`${r.tag_name}: removed, older than the last ${KEEP_DEV}`)
}
