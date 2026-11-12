//! What a channel's releases offer: the versions Banda publishes, in
//! order, and each release's engine feed (ADR 0119, decision 5), as
//! `scripts/engine.mjs` writes it. The rules are this machine's one copy:
//! the window's app reads the release they find newest
//! (`platform/updates/desktop/src/releases.ts`).

use serde::Deserialize;
use std::cmp::Ordering;

/// A version Banda publishes: `0.1.0-dev.N` until ADR 0092's step 4,
/// `MAJOR.N.PATCH` after.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Version {
    parts: [u64; 3],
    dev: Option<u64>,
}

impl Version {
    /// `text` as a version Banda publishes, if it is one.
    pub fn of(text: &str) -> Option<Version> {
        let (numbers, dev) = match text.split_once("-dev.") {
            Some((numbers, dev)) => (numbers, Some(number(dev)?)),
            None => (text, None),
        };
        let mut parts = numbers.split('.').map(number);
        let version = Version {
            parts: [parts.next()??, parts.next()??, parts.next()??],
            dev,
        };
        parts.next().is_none().then_some(version)
    }
}

/// A number with no sign and no leading zero, as SemVer has them.
fn number(text: &str) -> Option<u64> {
    let fits = !text.is_empty()
        && text.bytes().all(|b| b.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'));
    fits.then(|| text.parse().ok()).flatten()
}

impl Ord for Version {
    /// As SemVer orders them: a plain version above every `-dev.N` of the
    /// same numbers.
    fn cmp(&self, other: &Self) -> Ordering {
        self.parts
            .cmp(&other.parts)
            .then(match (self.dev, other.dev) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(a), Some(b)) => a.cmp(&b),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Whether `a` is above `b`. Nothing is above, or below, a version Banda
/// does not publish.
pub fn is_above(a: &str, b: &str) -> bool {
    matches!((Version::of(a), Version::of(b)), (Some(a), Some(b)) if a > b)
}

/// A release as GitHub's REST API gives it.
#[derive(Clone, Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    /// When it was published, as GitHub says it: `2026-11-12T05:17:00Z`.
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Asset {
    pub name: String,
    /// `uploaded` once it is all there.
    pub state: String,
    pub browser_download_url: String,
}

impl Release {
    /// When it was published, in ms since the epoch.
    pub fn published(&self) -> Option<i64> {
        utc_ms(self.published_at.as_deref()?)
    }

    /// Its file `name`, once it is all there.
    pub fn file(&self, name: &str) -> Option<&Asset> {
        (self.assets.iter()).find(|asset| asset.name == name && asset.state == "uploaded")
    }
}

/// Which Banda looks: Banda Dev reads every Dev, Banda only Stables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    Dev,
    Stable,
}

impl Which {
    /// The feed's first word, as electron-builder names the app's:
    /// `dev-engine-linux.yml`, `latest-engine-linux.yml`.
    pub fn feed(self) -> &'static str {
        match self {
            Which::Dev => "dev",
            Which::Stable => "latest",
        }
    }

    /// Whether `release` is one this Banda takes: a Dev any published
    /// release at a tag `v<version>`, as the window's; Banda only a Stable,
    /// not a prerelease and named `Banda <version>` (ADR 0092, decision 1).
    pub fn takes(self, release: &Release) -> bool {
        let Some(version) = release.tag_name.strip_prefix('v') else {
            return false;
        };
        !release.draft
            && match self {
                Which::Dev => true,
                Which::Stable => {
                    !release.prerelease
                        && release.name.as_deref() == Some(&format!("Banda {version}"))
                }
            }
    }
}

/// The releases `which` takes above `have`, highest first, with their
/// versions.
pub fn above<'a>(releases: &'a [Release], have: &str, which: Which) -> Vec<(&'a Release, String)> {
    let mut above: Vec<_> = (releases.iter())
        .filter(|release| which.takes(release))
        .map(|release| (release, release.tag_name[1..].to_owned()))
        .filter(|(_, version)| is_above(version, have))
        .collect();
    above.sort_by(|(_, a), (_, b)| Version::of(b).cmp(&Version::of(a)));
    above
}

/// The one file an engine feed names, as `scripts/engine.mjs` writes it in
/// electron-builder's shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Feed {
    pub version: String,
    pub file: String,
    /// The file's SHA-512, in base64.
    pub sha512: String,
    pub size: u64,
}

impl Feed {
    /// Reads `text`, the few lines electron-builder's feeds hold: its
    /// `version`, and its first file's `url`, `sha512` and `size`. What
    /// else it holds is passed over; a feed without one of them is none.
    pub fn read(text: &str) -> Option<Feed> {
        let mut version = None;
        let (mut file, mut sha512, mut size) = (None, None, None);
        let mut in_files = false;
        // The entries of `files:` seen so far: only the first counts.
        let mut entries = 0;
        for line in text.lines() {
            let trimmed = line.trim();
            if !line.starts_with([' ', '\t']) {
                in_files = trimmed == "files:";
                if let Some(value) = trimmed.strip_prefix("version:") {
                    version = Some(unquoted(value));
                }
                continue;
            }
            if !in_files {
                continue;
            }
            let entry = match trimmed.strip_prefix("- ") {
                Some(rest) => {
                    entries += 1;
                    rest
                }
                None => trimmed,
            };
            if entries != 1 {
                continue;
            }
            if let Some(value) = entry.strip_prefix("url:") {
                file = Some(unquoted(value));
            } else if let Some(value) = entry.strip_prefix("sha512:") {
                sha512 = Some(unquoted(value));
            } else if let Some(value) = entry.strip_prefix("size:") {
                size = unquoted(value).parse().ok();
            }
        }
        Some(Feed {
            version: version?,
            file: file?,
            sha512: sha512?,
            size: size?,
        })
    }
}

fn unquoted(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('\'')
        .and_then(|v| v.strip_suffix('\''))
        .or_else(|| value.strip_prefix('"').and_then(|v| v.strip_suffix('"')))
        .unwrap_or(value)
        .to_owned()
}

/// This system as a bundle's name says it: `linux` or `mac`, and
/// `x86_64` or `arm64`; none where Banda packs no engine alone.
pub fn system() -> Option<(&'static str, &'static str)> {
    let os = match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "mac",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "arm64",
        _ => return None,
    };
    Some((os, arch))
}

/// The feed's file name for `which` on `os`: `dev-engine-linux.yml`.
pub fn feed_name(which: Which, os: &str) -> String {
    format!("{}-engine-{os}.yml", which.feed())
}

/// The bundle's name for `folder`'s Banda at `version`.
pub fn bundle_name(folder: &str, version: &str, os: &str, arch: &str) -> String {
    format!("{folder}-{version}-engine-{os}-{arch}.tar.gz")
}

/// Why GitHub took no more looks, from an answer's `status` and headers,
/// when it is the limit of calls without a token, 60 an hour from one
/// address: it says when the hour's reset is, `now` being seconds since
/// the epoch.
pub fn limited(
    status: u16,
    remaining: Option<&str>,
    reset: Option<&str>,
    now: u64,
) -> Option<String> {
    if !matches!(status, 403 | 429) || remaining != Some("0") {
        return None;
    }
    let when = reset
        .and_then(|reset| reset.parse::<u64>().ok())
        .map(|reset| reset.saturating_sub(now).div_ceil(60).max(1));
    Some(match when {
        Some(minutes) => format!(
            "GitHub takes no more looks from this network for {minutes} min; Banda looks again later"
        ),
        None => "GitHub takes no more looks from this network this hour; Banda looks again later"
            .to_owned(),
    })
}

/// `2026-11-12T05:17:00Z`, as GitHub writes a time, in ms since the
/// epoch; none for any other form.
pub fn utc_ms(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 20 || bytes[19] != b'Z' {
        return None;
    }
    let number = |from: usize, to: usize| text.get(from..to)?.parse::<i64>().ok();
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    // Days since 1970-01-01 of a date of the proleptic Gregorian calendar.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let of_era = y - era * 400;
    let of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    let days = era * 146_097 + of_cycle - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_ordered_as_semver_orders_them() {
        assert!(is_above("0.1.0-dev.10", "0.1.0-dev.9"));
        assert!(is_above("0.1.0", "0.1.0-dev.900"));
        assert!(is_above("0.2.0-dev.1", "0.1.0"));
        assert!(is_above("1.0.0", "0.99.99"));
        assert!(!is_above("0.1.0-dev.9", "0.1.0-dev.9"));
        assert!(!is_above("0.1.0-dev.9", "0.1.0"));
        // Nothing is above, or below, what Banda does not publish.
        for odd in ["0.1.0-local", "0.1", "01.0.0", "0.1.0-dev.01", "v0.1.0", ""] {
            assert!(!is_above(odd, "0.0.1"), "{odd}");
            assert!(!is_above("9.9.9", odd), "{odd}");
        }
    }

    fn release(tag: &str, name: &str, prerelease: bool) -> Release {
        Release {
            tag_name: tag.to_owned(),
            name: Some(name.to_owned()),
            draft: false,
            prerelease,
            published_at: None,
            assets: vec![],
        }
    }

    #[test]
    fn dev_takes_every_dev_and_stable_only_a_stable() {
        let releases = [
            release("v0.1.0-dev.12", "Banda Dev 0.1.0-dev.12", true),
            release("v0.1.0-dev.11", "Banda Dev 0.1.0-dev.11", true),
            release("v0.1.0", "Banda 0.1.0", false),
            release("v0.1.1", "Not Banda", false),
            release("x0.9.0", "Banda 0.9.0", false),
        ];
        let dev: Vec<_> = above(&releases, "0.1.0-dev.11", Which::Dev)
            .into_iter()
            .map(|(_, version)| version)
            .collect();
        assert_eq!(dev, ["0.1.1", "0.1.0", "0.1.0-dev.12"]);
        let stable: Vec<_> = above(&releases, "0.0.9", Which::Stable)
            .into_iter()
            .map(|(_, version)| version)
            .collect();
        assert_eq!(stable, ["0.1.0"]);
    }

    #[test]
    fn a_feed_reads_as_engine_mjs_writes_it() {
        let text = "version: 0.1.0-dev.652\nfiles:\n  - url: banda-dev-0.1.0-dev.652-engine-linux-x86_64.tar.gz\n    sha512: VskG1Vz==\n    size: 54975026\npath: banda-dev-0.1.0-dev.652-engine-linux-x86_64.tar.gz\nsha512: VskG1Vz==\nreleaseDate: '2026-11-11T17:10:49.622Z'\n";
        assert_eq!(
            Feed::read(text),
            Some(Feed {
                version: "0.1.0-dev.652".into(),
                file: "banda-dev-0.1.0-dev.652-engine-linux-x86_64.tar.gz".into(),
                sha512: "VskG1Vz==".into(),
                size: 54_975_026,
            })
        );
        assert_eq!(Feed::read("version: 1.0.0\n"), None);
    }

    #[test]
    fn the_limit_says_when_it_ends() {
        let said = limited(403, Some("0"), Some("1000"), 1000 - 125).unwrap();
        assert!(said.contains("for 3 min"), "{said}");
        assert_eq!(limited(403, Some("12"), Some("1000"), 0), None);
        assert_eq!(limited(404, Some("0"), None, 0), None);
        assert!(
            limited(429, Some("0"), None, 0)
                .unwrap()
                .contains("this hour")
        );
    }

    #[test]
    fn github_s_times_read_as_ms() {
        assert_eq!(utc_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(utc_ms("2026-11-12T05:17:00Z"), Some(1_794_460_620_000));
        assert_eq!(utc_ms("2024-02-29T23:59:59Z"), Some(1_709_251_199_000));
        assert_eq!(utc_ms("2026-11-12 05:17:00"), None);
        assert_eq!(utc_ms("2026-13-12T05:17:00Z"), None);
    }
}
