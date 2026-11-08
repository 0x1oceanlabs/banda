/**
 * Where each Banda finds its next version: a source of its own,
 * electron-updater's `custom` provider (ADR 0092, decision 12). GitHub's
 * own takes only a tag with the running version's word, `dev`, so it would
 * never see a plain `0.750.0`; and it falls back from `dev-linux.yml` to
 * `latest-linux.yml`, which would install Banda over Banda Dev once a
 * release holds both apps' files.
 *
 * Banda Dev reads GitHub's list of releases, which holds no bare tag, so a
 * withdrawn release's kept tag is never seen. It takes the highest version
 * above its own whose release has its update file (`dev-linux.yml`,
 * `dev-mac.yml`, `dev.yml` on Windows) and only `banda-dev-<version>-…`
 * files. Banda reads the release marked Latest, refuses one that is no
 * Stable, reads `latest-linux.yml` or `latest-mac.yml`, and takes only
 * `banda-<version>-…`. Both know today's `0.1.0-dev.N` and the plain
 * `MAJOR.N.PATCH` that follows it (decision 5). Neither look needs a
 * token: one call to GitHub's API an hour.
 */
import { Schema } from "effect"
import {
  Provider,
  type ResolvedUpdateFileInfo,
  type UpdateInfo,
} from "electron-updater"
import {
  type ProviderRuntimeOptions,
  parseUpdateInfo,
} from "electron-updater/out/providers/Provider"
import { CHANNELS, REPOSITORY } from "./channel"

/** Which Banda looks: Banda Dev reads every release, Banda the Stable
 * marked Latest. */
export type Which = "dev" | "stable"

/** What `autoUpdater.setFeedURL` takes for `which`'s source. */
export function sourceOf(which: Which) {
  return { provider: "custom", updateProvider: Releases, which } as const
}

/** A version Banda publishes, in numbers: `0.1.0-dev.N` until ADR 0092's
 * step 4, with `dev` its N, then `MAJOR.N.PATCH`, with none. */
type Version = { parts: readonly [number, number, number]; dev?: number }

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/

/** `text` as a version Banda publishes, if it is one. */
function versionOf(text: string): Version | undefined {
  const [, major, n, patch, dev] = VERSION.exec(text) ?? []
  if (major === undefined) return undefined
  return {
    parts: [Number(major), Number(n), Number(patch)],
    ...(dev !== undefined && { dev: Number(dev) }),
  }
}

/** Whether `a` is above `b`, as SemVer orders them, and so electron-updater:
 * a plain version above every `-dev.N` of the same numbers. Nothing is
 * above, or below, a version Banda does not publish. */
export function isAbove(a: string, b: string): boolean {
  const x = versionOf(a)
  const y = versionOf(b)
  if (!x || !y) return false
  for (const i of [0, 1, 2] as const) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i]
  }
  if (x.dev === y.dev) return false
  if (x.dev === undefined) return true
  if (y.dev === undefined) return false
  return x.dev > y.dev
}

/** The version in an AppImage's name as electron-builder gives it
 * (`banda-dev-0.1.0-dev.420-x86_64.AppImage`), for `folder`'s app; none
 * for a file the Person renamed. */
export function versionInName(
  name: string,
  folder: string
): string | undefined {
  if (!name.startsWith(`${folder}-`)) return undefined
  const version = /^(.+)-[^-]+\.AppImage$/.exec(name.slice(folder.length + 1))
  return version && versionOf(version[1]!) ? version[1] : undefined
}

const Asset = Schema.Struct({
  name: Schema.String,
  /** `uploaded` once it is all there. */
  state: Schema.String,
  browser_download_url: Schema.String,
})

/** A release as GitHub's REST API gives it, its notes as text. */
const Release = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  body_text: Schema.optional(Schema.NullOr(Schema.String)),
  assets: Schema.Array(Asset),
})
export type Release = typeof Release.Type
type Asset = typeof Asset.Type

const readRelease = Schema.decodeUnknownSync(Schema.fromJsonString(Release))
const readReleases = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Release))
)

/** What an update file must hold for electron-updater to download from
 * it: each file's name and sha512. The rest it reads as it is. */
const UpdateFiles = Schema.Struct({
  version: Schema.String,
  files: Schema.NonEmptyArray(
    Schema.Struct({ url: Schema.String, sha512: Schema.String })
  ),
})
const isUpdateFiles = Schema.is(UpdateFiles)

/** The releases above `have`, highest first: published, at a tag
 * `v<version>` of a version Banda publishes. */
export function releasesAbove(
  releases: readonly Release[],
  have: string
): { release: Release; version: string }[] {
  return releases
    .filter((release) => !release.draft && release.tag_name.startsWith("v"))
    .map((release) => ({ release, version: release.tag_name.slice(1) }))
    .filter(({ version }) => isAbove(version, have))
    .sort((a, b) =>
      isAbove(a.version, b.version) ? -1 : isAbove(b.version, a.version) ? 1 : 0
    )
}

/** `release`'s file `name`, once it is all there. */
function fileOf(release: Release, name: string): Asset | undefined {
  return release.assets.find(
    (asset) => asset.name === name && asset.state === "uploaded"
  )
}

/** Where each file `info` names is, when `info` is `version`'s and names
 * only `folder`'s own files, `<folder>-<version>-…`; `missing`, when one
 * is not all there yet; `refused`, why it is not this app's. */
function filesOf(
  info: unknown,
  release: Release,
  version: string,
  folder: string
):
  { urls: Record<string, string> } | { missing: string } | { refused: string } {
  if (!isUpdateFiles(info)) return { refused: "it names no files" }
  if (info.version !== version)
    return { refused: `it is ${info.version}'s, not ${version}'s` }
  const urls: Record<string, string> = {}
  for (const { url: name } of info.files) {
    if (!name.startsWith(`${folder}-${version}-`) || name.includes("/"))
      return { refused: `${name} is not ${folder}'s` }
    const asset = fileOf(release, name)
    if (!asset) return { missing: name }
    urls[name] = asset.browser_download_url
  }
  return { urls }
}

/** What changed up to `version`, newest first, of the releases `above`
 * the running version: each release's notes. */
function notesUpTo(
  above: ReturnType<typeof releasesAbove>,
  version: string
): { version: string; note: string | null }[] {
  return above
    .filter((one) => !isAbove(one.version, version))
    .map((one) => ({
      version: one.version,
      note: one.release.body_text ?? null,
    }))
}

/** An update file `Releases` found, with where its files are. */
type Found = UpdateInfo & { urls: Record<string, string> }

/** A coded error, as electron-updater's are. */
const coded = (message: string, code: string) =>
  Object.assign(new Error(message), { code })

/** The look's answer when nothing is above `have`: `have` itself, which
 * electron-updater takes for no update. */
const nothingAbove = (have: string): Found => ({
  version: have,
  files: [],
  path: "",
  sha512: "",
  releaseDate: "",
  urls: {},
})

/**
 * The error to show for `error`, an answer of GitHub's API, when it is the
 * limit of calls without a token, 60 an hour from one address, as on a
 * network many share: the next look after the hour's reset finds the
 * version, so it says when that is, `at` being now.
 */
export function limitOf(error: unknown, at: number): Error | undefined {
  const { statusCode, message = "" } = error as {
    statusCode?: number
    message?: string
  }
  const header = (name: string) =>
    new RegExp(`"x-ratelimit-${name}":\\s*"(\\d+)"`).exec(message)?.[1]
  if ((statusCode !== 403 && statusCode !== 429) || header("remaining") !== "0")
    return undefined
  const reset = Number(header("reset")) * 1000
  const minutes = Math.max(1, Math.ceil((reset - at) / 60_000))
  return coded(
    `GitHub takes no more looks from this network ${Number.isFinite(minutes) ? `for ${minutes} min` : "this hour"}; Banda looks again later`,
    "ERR_BANDA_LIMITED"
  )
}

/** What `Releases` reads of electron-updater's updater. */
type Updater = { readonly currentVersion: { readonly version: string } }

/**
 * The source itself. electron-updater asks it for the newest version it
 * may install, compares that with the running one and downloads from
 * `resolveFiles`. It never installs one below or at its own, as
 * `allowDowngrade` is off.
 */
export class Releases extends Provider<Found> {
  private readonly which: Which
  private readonly updater: Updater

  constructor(
    options: { which: Which },
    updater: Updater,
    runtime: ProviderRuntimeOptions
  ) {
    // GitHub keeps release files where a request takes one range.
    super({ ...runtime, isUseMultipleRangeRequest: false })
    this.which = options.which
    this.updater = updater
  }

  async getLatestVersion(): Promise<Found> {
    const have = this.updater.currentVersion.version
    const { folder } = CHANNELS[this.which]
    const file = `${this.getCustomChannelName(this.which === "dev" ? "dev" : "latest")}.yml`
    const releases =
      this.which === "dev"
        ? readReleases(await this.api("/releases?per_page=100"))
        : await this.latest()
    // A release published before its files for this platform, as a Mac's
    // are today (ADR 0033, decision 6): a look again soon finds them.
    let coming: string | undefined
    const above = releasesAbove(releases, have)
    for (const { release, version } of above) {
      const update = fileOf(release, file)
      if (!update) {
        coming ??= `${version} has no ${file} yet`
        continue
      }
      const url = new URL(update.browser_download_url)
      const info = parseUpdateInfo(await this.httpRequest(url), file, url)
      const files = filesOf(info, release, version, folder)
      if ("refused" in files) {
        console.warn(`Banda does not take ${version}: ${file} ${files.refused}`)
        continue
      }
      if ("missing" in files) {
        coming ??= `${version} has no ${files.missing} yet`
        continue
      }
      return {
        ...info,
        urls: files.urls,
        releaseName: release.name,
        releaseNotes: notesUpTo(above, version),
      }
    }
    if (coming) throw coded(coming, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
    return nothingAbove(have)
  }

  resolveFiles(info: Found): ResolvedUpdateFileInfo[] {
    return info.files.map((file) => {
      const url = info.urls[file.url]
      if (!url)
        throw coded(`${file.url} is not in its release`, "ERR_BANDA_NO_FILE")
      return { url: new URL(url), info: file }
    })
  }

  /** Banda's release: the one marked Latest, when it is a Stable, named
   * `Banda <version>` (ADR 0092, decision 1); none before the first. */
  private async latest(): Promise<Release[]> {
    let text: string
    try {
      text = await this.api("/releases/latest")
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return []
      throw error
    }
    const release = readRelease(text)
    const version = release.tag_name.slice(1)
    if (release.prerelease || release.name !== `Banda ${version}`)
      throw coded(
        `${release.tag_name}, marked Latest, is not a Stable`,
        "ERR_BANDA_NOT_STABLE"
      )
    return [release]
  }

  /** GitHub's REST API at `path` of Banda's repository, with each
   * release's notes as text. */
  private async api(path: string): Promise<string> {
    const { owner, repo } = REPOSITORY
    let text: string | null
    try {
      text = await this.httpRequest(
        new URL(`https://api.github.com/repos/${owner}/${repo}${path}`),
        {
          accept: "application/vnd.github.text+json",
          "x-github-api-version": "2022-11-28",
        }
      )
    } catch (error) {
      throw limitOf(error, Date.now()) ?? error
    }
    if (text === null)
      throw coded(`GitHub gave nothing for ${path}`, "ERR_BANDA_NO_RELEASES")
    return text
  }
}
