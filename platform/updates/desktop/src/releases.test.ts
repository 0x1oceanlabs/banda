import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider"
import { describe, expect, it, vi } from "vitest"
import {
  isAbove,
  limitOf,
  type Release,
  Releases,
  releasesAbove,
  versionInName,
} from "./releases"

const API = "https://api.github.com/repos/0x1oceanlabs/banda"
const DOWNLOAD = "https://github.com/0x1oceanlabs/banda/releases/download"

/** A release as GitHub's API lists it, with `files` all up. */
function release(
  version: string,
  files: string[],
  more: Partial<Release> = {}
): Release {
  return {
    tag_name: `v${version}`,
    name: `Banda Dev ${version}`,
    draft: false,
    prerelease: true,
    body_text: `Built from abc1234: the change in ${version}`,
    assets: files.map((name) => ({
      name,
      state: "uploaded",
      browser_download_url: `${DOWNLOAD}/v${version}/${name}`,
    })),
    ...more,
  }
}

/** The update file electron-builder writes beside `file`. */
const yml = (version: string, file: string) =>
  `version: ${version}
files:
  - url: ${file}
    sha512: c2hhNTEy
    size: 183007420
    blockMapSize: 192192
path: ${file}
sha512: c2hhNTEy
releaseDate: '2026-11-08T05:17:00.000Z'
`

/** Banda Dev's release on Linux: its AppImage and `dev-linux.yml`. */
const devRelease = (version: string, more: Partial<Release> = {}) =>
  release(
    version,
    [`banda-dev-${version}-x86_64.AppImage`, "dev-linux.yml"],
    more
  )

/** What GitHub answers, by URL: text, or a status it fails with, maybe
 * with headers. */
type Answers = Record<
  string,
  string | number | { status: number; headers: Record<string, string> }
>

/** The source as electron-updater makes it, for `which` running `have` on
 * `platform`, its engine having found `newest`, over `answers` in place of
 * the network. */
function source(
  which: "dev" | "stable",
  have: string,
  newest: string | undefined,
  answers: Answers,
  platform: "linux" | "darwin" = "linux"
) {
  const asked: string[] = []
  const executor = {
    request: vi.fn(async (options: { hostname: string; path: string }) => {
      const url = `https://${options.hostname}${options.path}`
      asked.push(url)
      const answer = answers[url]
      if (typeof answer === "string") return answer
      // As builder-util-runtime's HttpError: the headers after the status.
      const { status, headers } =
        typeof answer === "object"
          ? answer
          : { status: answer ?? 404, headers: {} }
      throw Object.assign(
        new Error(
          `${status} for ${url}\nHeaders: ${JSON.stringify(headers, null, 2)}`
        ),
        { statusCode: status }
      )
    }),
  }
  const releases = new Releases(
    {
      which,
      folder: which === "dev" ? "banda-dev" : "banda",
      repository: { owner: "0x1oceanlabs", repo: "banda" },
      newest: () => newest,
    },
    { currentVersion: { version: have } },
    {
      platform,
      executor: executor as unknown as ProviderRuntimeOptions["executor"],
      isUseMultipleRangeRequest: true,
    }
  )
  return { releases, asked }
}

/** Banda Dev's answers: the list, and each release's `dev-linux.yml`. */
function devAnswers(list: Release[], ymls: Record<string, string> = {}) {
  const answers: Answers = {
    [`${API}/releases?per_page=100`]: JSON.stringify(list),
  }
  for (const r of list) {
    const version = r.tag_name.slice(1)
    for (const asset of r.assets.filter((a) => a.name.endsWith(".yml")))
      answers[asset.browser_download_url] =
        ymls[`${version}/${asset.name}`] ??
        yml(version, `banda-dev-${version}-x86_64.AppImage`)
  }
  return answers
}

describe("versions", () => {
  it("orders today's dev.N and the plain MAJOR.N.PATCH as SemVer does (ADR 0092, decision 5)", () => {
    expect(isAbove("0.1.0-dev.421", "0.1.0-dev.420")).toBe(true)
    expect(isAbove("0.1.0-dev.1000", "0.1.0-dev.999")).toBe(true)
    expect(isAbove("0.1.0-dev.420", "0.1.0-dev.420")).toBe(false)
    // The first plain version is above every Dev of today.
    expect(isAbove("0.750.0", "0.1.0-dev.420")).toBe(true)
    expect(isAbove("0.1.0-dev.420", "0.750.0")).toBe(false)
    expect(isAbove("0.761.0", "0.750.0")).toBe(true)
    expect(isAbove("1.1.0", "0.64999.0")).toBe(true)
    expect(isAbove("0.761.1", "0.761.0")).toBe(true)
    // A plain version is above a Dev of its own numbers.
    expect(isAbove("0.1.0", "0.1.0-dev.420")).toBe(true)
  })

  it("knows no version Banda does not publish", () => {
    for (const other of [
      "0.1.0-local",
      "0.0.0-local",
      "0.2.0-rc.1",
      "v0.750.0",
      "0.750",
      "01.2.3",
    ]) {
      expect(isAbove(other, "0.1.0-dev.1")).toBe(false)
      expect(isAbove("0.750.0", other)).toBe(false)
    }
  })

  it("reads the version in an AppImage's name", () => {
    expect(
      versionInName("banda-dev-0.1.0-dev.420-x86_64.AppImage", "banda-dev")
    ).toBe("0.1.0-dev.420")
    expect(versionInName("banda-dev-0.750.0-arm64.AppImage", "banda-dev")).toBe(
      "0.750.0"
    )
    expect(versionInName("banda-0.761.0-x86_64.AppImage", "banda")).toBe(
      "0.761.0"
    )
    // Banda's file is not Banda Dev's, and a name the Person chose has none.
    expect(
      versionInName("banda-dev-0.750.0-x86_64.AppImage", "banda")
    ).toBeUndefined()
    expect(versionInName("Banda.AppImage", "banda-dev")).toBeUndefined()
  })

  it("lists the releases above a version, highest first, and no draft", () => {
    const list = [
      devRelease("0.1.0-dev.419"),
      devRelease("0.750.0", { prerelease: false, name: "Banda 0.750.0" }),
      devRelease("0.1.0-dev.421"),
      devRelease("0.1.0-dev.430", { draft: true }),
      devRelease("0.1.0-dev.410"),
      { ...devRelease("0.1.0-dev.440"), tag_name: "nightly" },
    ]
    expect(
      releasesAbove(list, "0.1.0-dev.410").map((above) => above.version)
    ).toEqual(["0.750.0", "0.1.0-dev.421", "0.1.0-dev.419"])
  })
})

describe("Banda Dev's source", () => {
  it("takes the version its engine found newest, with what changed since its own", async () => {
    const list = [
      devRelease("0.750.0"),
      devRelease("0.1.0-dev.421"),
      devRelease("0.1.0-dev.420"),
      devRelease("0.1.0-dev.419"),
    ]
    const { releases, asked } = source(
      "dev",
      "0.1.0-dev.420",
      "0.750.0",
      devAnswers(list)
    )
    const found = await releases.getLatestVersion()
    expect(found.version).toBe("0.750.0")
    expect(found.releaseName).toBe("Banda Dev 0.750.0")
    // What changed since its own, newest first.
    expect(found.releaseNotes).toEqual([
      { version: "0.750.0", note: "Built from abc1234: the change in 0.750.0" },
      {
        version: "0.1.0-dev.421",
        note: "Built from abc1234: the change in 0.1.0-dev.421",
      },
    ])
    expect(releases.resolveFiles(found)).toEqual([
      expect.objectContaining({
        url: new URL(`${DOWNLOAD}/v0.750.0/banda-dev-0.750.0-x86_64.AppImage`),
      }),
    ])
    // One call to GitHub's API, with the notes as text, and the one file.
    expect(asked).toEqual([
      `${API}/releases?per_page=100`,
      `${DOWNLOAD}/v0.750.0/dev-linux.yml`,
    ])
  })

  it("takes no other version than the engine's newest, below it too", async () => {
    const list = [devRelease("0.1.0-dev.422"), devRelease("0.1.0-dev.421")]
    const { releases } = source(
      "dev",
      "0.1.0-dev.420",
      "0.1.0-dev.421",
      devAnswers(list)
    )
    expect((await releases.getLatestVersion()).version).toBe("0.1.0-dev.421")
  })

  it("reads nothing before its engine looked, or with nothing above its own", async () => {
    const list = [devRelease("0.1.0-dev.420"), devRelease("0.1.0-dev.419")]
    for (const newest of [undefined, "0.1.0-dev.420", "0.1.0-dev.419"]) {
      const { releases, asked } = source(
        "dev",
        "0.1.0-dev.420",
        newest,
        devAnswers(list)
      )
      expect(await releases.getLatestVersion()).toMatchObject({
        version: "0.1.0-dev.420",
        files: [],
      })
      expect(asked).toEqual([])
    }
  })

  it("reads a newest past the list's hundred by its tag", async () => {
    const answers = devAnswers([devRelease("0.1.0-dev.421")])
    const far = devRelease("0.1.0-dev.530")
    answers[`${API}/releases/tags/v0.1.0-dev.530`] = JSON.stringify(far)
    answers[`${DOWNLOAD}/v0.1.0-dev.530/dev-linux.yml`] = yml(
      "0.1.0-dev.530",
      "banda-dev-0.1.0-dev.530-x86_64.AppImage"
    )
    const { releases } = source(
      "dev",
      "0.1.0-dev.420",
      "0.1.0-dev.530",
      answers
    )
    const found = await releases.getLatestVersion()
    expect(found.version).toBe("0.1.0-dev.530")
    expect(found.releaseNotes).toEqual([
      {
        version: "0.1.0-dev.530",
        note: "Built from abc1234: the change in 0.1.0-dev.530",
      },
      {
        version: "0.1.0-dev.421",
        note: "Built from abc1234: the change in 0.1.0-dev.421",
      },
    ])
  })

  it("never takes Banda's files", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { releases } = source(
      "dev",
      "0.1.0-dev.420",
      "0.761.0",
      devAnswers([devRelease("0.761.0")], {
        "0.761.0/dev-linux.yml": yml(
          "0.761.0",
          "banda-0.761.0-x86_64.AppImage"
        ),
      })
    )
    expect((await releases.getLatestVersion()).version).toBe("0.1.0-dev.420")
    expect(warn).toHaveBeenCalledWith(
      "Banda does not take 0.761.0: dev-linux.yml banda-0.761.0-x86_64.AppImage is not banda-dev's"
    )
    warn.mockRestore()
  })

  it("refuses an update file of another version", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { releases } = source(
      "dev",
      "0.1.0-dev.420",
      "0.750.0",
      devAnswers([devRelease("0.750.0")], {
        "0.750.0/dev-linux.yml": yml(
          "0.751.0",
          "banda-dev-0.751.0-x86_64.AppImage"
        ),
      })
    )
    expect((await releases.getLatestVersion()).version).toBe("0.1.0-dev.420")
    warn.mockRestore()
  })

  it("on a Mac reads dev-mac.yml, and says a release whose files are still coming", async () => {
    const mac = (version: string, files: string[]) =>
      release(version, [
        `banda-dev-${version}-x86_64.AppImage`,
        "dev-linux.yml",
        ...files,
      ])
    const list = [mac("0.1.0-dev.421", [])]
    const { releases } = source(
      "dev",
      "0.1.0-dev.420",
      "0.1.0-dev.421",
      devAnswers(list),
      "darwin"
    )
    await expect(releases.getLatestVersion()).rejects.toMatchObject({
      code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
      message: "0.1.0-dev.421 has no dev-mac.yml yet",
    })

    // The zip is still going up, under its update file.
    const going = mac("0.1.0-dev.421", [
      "banda-dev-0.1.0-dev.421-arm64.zip",
      "dev-mac.yml",
    ])
    const answers = devAnswers([
      {
        ...going,
        assets: going.assets.map((asset) =>
          asset.name.endsWith(".zip") ? { ...asset, state: "open" } : asset
        ),
      },
    ])
    answers[`${DOWNLOAD}/v0.1.0-dev.421/dev-mac.yml`] = yml(
      "0.1.0-dev.421",
      "banda-dev-0.1.0-dev.421-arm64.zip"
    )
    await expect(
      source(
        "dev",
        "0.1.0-dev.420",
        "0.1.0-dev.421",
        answers,
        "darwin"
      ).releases.getLatestVersion()
    ).rejects.toMatchObject({ code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" })
  })

  it("finds nothing for a version Banda does not publish, as a PR's build", async () => {
    const { releases } = source(
      "dev",
      "0.1.0-local",
      "0.750.0",
      devAnswers([devRelease("0.750.0")])
    )
    expect((await releases.getLatestVersion()).version).toBe("0.1.0-local")
  })

  it("fails a look when GitHub does, as the next look tries again", async () => {
    const { releases } = source("dev", "0.1.0-dev.420", "0.1.0-dev.421", {
      [`${API}/releases?per_page=100`]: 403,
    })
    await expect(releases.getLatestVersion()).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("says when GitHub takes looks again, once a network spent its 60 an hour", async () => {
    const at = Date.parse("2026-11-08T12:00:00Z")
    vi.useFakeTimers({ now: at })
    try {
      const { releases } = source("dev", "0.1.0-dev.420", "0.1.0-dev.421", {
        [`${API}/releases?per_page=100`]: {
          status: 403,
          headers: {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(at / 1000 + 23 * 60 - 5),
          },
        },
      })
      await expect(releases.getLatestVersion()).rejects.toMatchObject({
        code: "ERR_BANDA_LIMITED",
        message:
          "GitHub takes no more looks from this network for 23 min; Banda looks again later",
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("GitHub's limit", () => {
  const limited = (status: number, headers: Record<string, string>) =>
    Object.assign(
      new Error(`${status}\nHeaders: ${JSON.stringify(headers, null, 2)}`),
      { statusCode: status }
    )
  const at = 1_762_603_200_000

  it("is a 403 or a 429 with no call left", () => {
    const spent = { "x-ratelimit-remaining": "0" }
    expect(limitOf(limited(429, spent), at)?.message).toBe(
      "GitHub takes no more looks from this network this hour; Banda looks again later"
    )
    expect(limitOf(limited(403, spent), at)).toBeDefined()
    // A 403 with calls left is another refusal, shown as it is.
    expect(
      limitOf(limited(403, { "x-ratelimit-remaining": "12" }), at)
    ).toBeUndefined()
    expect(limitOf(limited(500, spent), at)).toBeUndefined()
    expect(limitOf(new Error("net::ERR_INTERNET_DISCONNECTED"), at)).toBe(
      undefined
    )
  })

  it("rounds the wait up to a minute at least", () => {
    const headers = (reset: number) => ({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(reset),
    })
    expect(limitOf(limited(403, headers(at / 1000 + 10)), at)?.message).toBe(
      "GitHub takes no more looks from this network for 1 min; Banda looks again later"
    )
    expect(limitOf(limited(403, headers(at / 1000 - 60)), at)?.message).toBe(
      "GitHub takes no more looks from this network for 1 min; Banda looks again later"
    )
  })
})

describe("Banda's source", () => {
  const stable = (version: string, more: Partial<Release> = {}) =>
    release(
      version,
      [
        `banda-dev-${version}-x86_64.AppImage`,
        "dev-linux.yml",
        `banda-${version}-x86_64.AppImage`,
        "latest-linux.yml",
      ],
      { name: `Banda ${version}`, prerelease: false, ...more }
    )
  const answers = (newest: Release): Answers => {
    const version = newest.tag_name.slice(1)
    return {
      [`${API}/releases/tags/v${version}`]: JSON.stringify(newest),
      [`${DOWNLOAD}/v${version}/latest-linux.yml`]: yml(
        version,
        `banda-${version}-x86_64.AppImage`
      ),
    }
  }

  it("takes the Stable its engine found newest, Banda's files only", async () => {
    const { releases, asked } = source(
      "stable",
      "0.750.0",
      "0.761.0",
      answers(stable("0.761.0"))
    )
    const found = await releases.getLatestVersion()
    expect(found.version).toBe("0.761.0")
    expect(found.releaseNotes).toEqual([
      { version: "0.761.0", note: "Built from abc1234: the change in 0.761.0" },
    ])
    expect(releases.resolveFiles(found)[0]!.url.href).toBe(
      `${DOWNLOAD}/v0.761.0/banda-0.761.0-x86_64.AppImage`
    )
    expect(asked).toEqual([
      `${API}/releases/tags/v0.761.0`,
      `${DOWNLOAD}/v0.761.0/latest-linux.yml`,
    ])
  })

  it("finds nothing before its engine found a Stable above its own", async () => {
    const { releases, asked } = source("stable", "0.750.0", "0.750.0", {})
    expect((await releases.getLatestVersion()).version).toBe("0.750.0")
    expect(asked).toEqual([])
  })

  it("never takes Banda Dev's files", async () => {
    const all = answers(stable("0.761.0"))
    all[`${DOWNLOAD}/v0.761.0/latest-linux.yml`] = yml(
      "0.761.0",
      "banda-dev-0.761.0-x86_64.AppImage"
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { releases } = source("stable", "0.750.0", "0.761.0", all)
    expect((await releases.getLatestVersion()).version).toBe("0.750.0")
    warn.mockRestore()
  })
})
