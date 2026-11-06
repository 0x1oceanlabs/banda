//! `files.info` and `files.size`: what a path is, at length, for Files'
//! info (ADR 0073, step F6). Its kind and type, its size and times, its
//! permissions and owner, and where a link leads; a picture's size and
//! what its camera wrote (`kamadak-exif`); the last commit that changed it
//! in a git repository; and, counted as asked, what a folder holds.

use crate::model::{Commit, Counted, Exif, Info, Kind, Picture};
use crate::read;
use exif::{In, Tag, Value};
use std::fs::Metadata;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

/// How long git may take to name the last commit.
const GIT_TIME: Duration = Duration::from_secs(5);

/// How often `files.size` says how far it is.
const SAY_EVERY: Duration = Duration::from_millis(100);

/// What is at `own`, a link not followed, and at `real`, where it leads.
/// Reads the disk.
pub fn facts(own: &Path, real: &Path) -> std::io::Result<Info> {
    let itself = own.symlink_metadata()?;
    let link = itself.is_symlink();
    let led = std::fs::metadata(real).ok();
    let dangling = link && led.is_none();
    let meta = led.as_ref().unwrap_or(&itself);
    let folder = meta.is_dir();
    let kind = match (link, folder) {
        (true, _) => Kind::Link,
        (false, true) => Kind::Folder,
        (false, false) => Kind::File,
    };
    let file = !folder && !dangling;
    let mut info = Info {
        path: crate::shown(own),
        kind,
        link: link
            .then(|| std::fs::read_link(own).ok())
            .flatten()
            .map(|to| crate::shown(&to)),
        dangling,
        mime: file.then(|| read::mime(real)),
        size: file.then_some(meta.len()),
        items: folder
            .then(|| {
                std::fs::read_dir(real)
                    .ok()
                    .map(|names| names.count() as u32)
            })
            .flatten(),
        created: meta.created().ok().and_then(crate::ms),
        modified: meta.modified().ok().and_then(crate::ms),
        accessed: meta.accessed().ok().and_then(crate::ms),
        mode: mode(meta),
        owner: None,
        group: None,
        picture: None,
        exif: None,
        commit: None,
    };
    (info.owner, info.group) = owner(meta);
    if info
        .mime
        .as_deref()
        .is_some_and(|mime| mime.starts_with("image/"))
    {
        let exif = read_exif(real);
        let turned = exif.as_ref().is_some_and(turned);
        info.picture = picture(real, turned);
        info.exif = exif
            .as_ref()
            .map(exif_of)
            .filter(|said| *said != Exif::default());
    }
    Ok(info)
}

#[cfg(unix)]
fn mode(meta: &Metadata) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.mode() & 0o7777)
}

#[cfg(not(unix))]
fn mode(_meta: &Metadata) -> Option<u32> {
    None
}

/// Who owns it, and its group, by name; by number where none is known.
#[cfg(unix)]
fn owner(meta: &Metadata) -> (Option<String>, Option<String>) {
    use nix::unistd::{Gid, Group, Uid, User};
    use std::os::unix::fs::MetadataExt;
    let user = User::from_uid(Uid::from_raw(meta.uid())).ok().flatten();
    let group = Group::from_gid(Gid::from_raw(meta.gid())).ok().flatten();
    (
        Some(user.map_or_else(|| meta.uid().to_string(), |user| user.name)),
        Some(group.map_or_else(|| meta.gid().to_string(), |group| group.name)),
    )
}

#[cfg(not(unix))]
fn owner(_meta: &Metadata) -> (Option<String>, Option<String>) {
    (None, None)
}

/// A picture's size, read from its header, its sides swapped when its
/// EXIF turns it a quarter.
fn picture(path: &Path, turned: bool) -> Option<Picture> {
    let reader = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?;
    let (width, height) = reader.into_dimensions().ok()?;
    Some(if turned {
        Picture {
            width: height,
            height: width,
        }
    } else {
        Picture { width, height }
    })
}

fn read_exif(path: &Path) -> Option<exif::Exif> {
    let file = std::fs::File::open(path).ok()?;
    exif::Reader::new()
        .read_from_container(&mut std::io::BufReader::new(file))
        .ok()
}

/// Whether the EXIF turns the picture a quarter, either way.
fn turned(exif: &exif::Exif) -> bool {
    (exif.get_field(Tag::Orientation, In::PRIMARY))
        .and_then(|field| field.value.get_uint(0))
        .is_some_and(|orientation| (5..=8).contains(&orientation))
}

/// What a camera wrote, as words.
fn exif_of(exif: &exif::Exif) -> Exif {
    let text = |tag: Tag| {
        let field = exif.get_field(tag, In::PRIMARY)?;
        let Value::Ascii(parts) = &field.value else {
            return None;
        };
        let words = String::from_utf8_lossy(parts.first()?);
        let words = words.trim_matches(|c: char| c == '\0' || c.is_whitespace());
        (!words.is_empty()).then(|| words.to_owned())
    };
    let number = |tag: Tag| {
        let field = exif.get_field(tag, In::PRIMARY)?;
        match &field.value {
            Value::Rational(values) => values.first().map(|value| value.to_f64()),
            Value::SRational(values) => values.first().map(|value| value.to_f64()),
            value => value.get_uint(0).map(f64::from),
        }
        .filter(|number| number.is_finite())
    };
    let camera = match (text(Tag::Make), text(Tag::Model)) {
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase()) => {
            Some(model)
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (make, model) => model.or(make),
    };
    let exposure: Vec<String> = [
        number(Tag::ExposureTime).map(|time| {
            if time > 0.0 && time < 1.0 {
                format!("1/{} s", (1.0 / time).round())
            } else {
                format!("{} s", trimmed(time))
            }
        }),
        number(Tag::FNumber).map(|f| format!("f/{}", trimmed(f))),
        number(Tag::PhotographicSensitivity).map(|iso| format!("ISO {iso}")),
        number(Tag::FocalLength).map(|focal| format!("{} mm", trimmed(focal))),
    ]
    .into_iter()
    .flatten()
    .collect();
    Exif {
        camera,
        lens: text(Tag::LensModel).or_else(|| text(Tag::LensMake)),
        taken: text(Tag::DateTimeOriginal)
            .or_else(|| text(Tag::DateTime))
            .map(|when| taken(&when)),
        exposure: (!exposure.is_empty()).then(|| exposure.join(" · ")),
        place: place(exif),
    }
}

/// A number with at most one place after the point, and none for a
/// whole one.
fn trimmed(number: f64) -> String {
    let rounded = (number * 10.0).round() / 10.0;
    if rounded.fract() == 0.0 {
        format!("{rounded:.0}")
    } else {
        format!("{rounded:.1}")
    }
}

/// EXIF's `2026:05:04 18:30:12` as a person reads it: `2026-05-04
/// 18:30:12`.
fn taken(when: &str) -> String {
    match when.split_once(' ') {
        Some((day, time)) => format!("{} {time}", day.replace(':', "-")),
        None => when.to_owned(),
    }
}

/// Where a picture was taken, as text: `48.85837° N, 2.29448° E`.
fn place(exif: &exif::Exif) -> Option<String> {
    let degrees = |tag: Tag, side: Tag| -> Option<(f64, char)> {
        let field = exif.get_field(tag, In::PRIMARY)?;
        let Value::Rational(parts) = &field.value else {
            return None;
        };
        let [d, m, s] = [parts.first()?, parts.get(1)?, parts.get(2)?].map(|part| part.to_f64());
        let side = exif.get_field(side, In::PRIMARY)?;
        let Value::Ascii(said) = &side.value else {
            return None;
        };
        let side = *said.first()?.first()? as char;
        let value = d + m / 60.0 + s / 3600.0;
        value.is_finite().then_some((value, side))
    };
    let (latitude, north) = degrees(Tag::GPSLatitude, Tag::GPSLatitudeRef)?;
    let (longitude, east) = degrees(Tag::GPSLongitude, Tag::GPSLongitudeRef)?;
    Some(format!("{latitude:.5}° {north}, {longitude:.5}° {east}"))
}

/// The last commit that changed what is at `path`, a folder's too, in the
/// git repository it is in; none outside one, or when git is not there.
/// git runs as Files runs it for `check-ignore` (`git_in`), and at most
/// [`GIT_TIME`].
pub async fn last_commit(path: &Path) -> Option<Commit> {
    // A folder's from inside it, so the top of a repository has its own.
    let (at, name) = match (path.parent(), path.file_name()) {
        (Some(at), Some(name)) if !path.is_dir() => (at, name),
        _ => (path, std::ffi::OsStr::new(".")),
    };
    let git = async {
        crate::git_in(at)
            .await?
            .args([
                "log",
                "-1",
                "--no-color",
                "--format=%H%x00%an%x00%at%x00%s",
                "--",
            ])
            .arg(name)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .output()
            .await
            .ok()
    };
    let out = tokio::time::timeout(GIT_TIME, git).await.ok()??;
    if !out.status.success() {
        return None;
    }
    let said = String::from_utf8_lossy(&out.stdout);
    let mut parts = said.trim_end_matches('\n').splitn(4, '\0');
    let (hash, author, when, subject) =
        (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    if hash.is_empty() {
        return None;
    }
    Some(Commit {
        hash: hash.to_owned(),
        author: author.to_owned(),
        when: when.parse::<i64>().ok()?.saturating_mul(1000),
        subject: subject.to_owned(),
    })
}

/// Counts what the folder at `dir` holds, its links' own sizes, not what
/// they lead to: says how far it is every [`SAY_EVERY`], then that it is
/// done; stops once `say` says no one hears.
pub fn count(dir: &Path, say: &mut dyn FnMut(Counted) -> bool) {
    let mut counted = Counted::default();
    let mut said = Instant::now();
    let mut folders = vec![dir.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(names) = std::fs::read_dir(&folder) else {
            continue;
        };
        for name in names.filter_map(Result::ok) {
            let Ok(meta) = name.metadata() else { continue };
            if meta.is_dir() {
                folders.push(name.path());
            } else {
                counted.bytes += meta.len();
                counted.files += 1;
            }
            if said.elapsed() >= SAY_EVERY {
                if !say(counted) {
                    return;
                }
                said = Instant::now();
            }
        }
    }
    counted.done = true;
    say(counted);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exif_times_and_numbers_read_as_a_person_reads_them() {
        assert_eq!(taken("2026:05:04 18:30:12"), "2026-05-04 18:30:12");
        assert_eq!(trimmed(2.8), "2.8");
        assert_eq!(trimmed(35.0), "35");
        assert_eq!(trimmed(4.0000001), "4");
    }

    #[test]
    fn a_folder_is_counted_with_what_its_folders_hold() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
        std::fs::write(dir.path().join("one"), [0; 10]).unwrap();
        std::fs::write(dir.path().join("a/two"), [0; 20]).unwrap();
        std::fs::write(dir.path().join("a/b/three"), [0; 30]).unwrap();
        let mut heard = Vec::new();
        count(dir.path(), &mut |counted| {
            heard.push(counted);
            true
        });
        assert_eq!(
            heard.last(),
            Some(&Counted {
                bytes: 60,
                files: 3,
                done: true
            })
        );
    }
}
