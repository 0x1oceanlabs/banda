//! The path guard (ADR 0073, decision 14): where a path a call names
//! really is, and whether its caller may reach it.
//!
//! A relative path starts at the Project's folder. The Person may name
//! any path, absolute or not. An Agent's call, which its pass walls in
//! its Project, reaches only inside the Project's folder: the path is
//! read as the system reads it, links and `..` followed, and refused when
//! it lands outside. A path that is not there yet, as one about to be
//! written, is read through the nearest folder above it that is.

use crate::{Call, Refusal};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// A path a call may reach, as the system reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reach {
    path: PathBuf,
    inside: bool,
}

impl Reach {
    /// The path `asked` of `call`: from its Project's folder when it is
    /// relative, and held inside that folder when an Agent asks.
    pub fn of(call: &Call, asked: impl AsRef<Path>) -> Result<Reach, Refusal> {
        Reach::resolve(&call.project().folder(), asked, call.wall().is_some())
    }

    /// The path `asked`, from `folder` when it is relative. `walled` holds
    /// it inside `folder`, as an Agent's call is.
    pub fn resolve(folder: &Path, asked: impl AsRef<Path>, walled: bool) -> Result<Reach, Refusal> {
        let asked = asked.as_ref();
        let folder = folder
            .canonicalize()
            .unwrap_or_else(|_| folder.to_path_buf());
        let joined = folder.join(asked);
        let path = real(&joined, walled).map_err(|why| why.refusal(asked))?;
        let inside = path.starts_with(&folder);
        if walled && !inside {
            return Err(Refusal::forbidden(format!(
                "An Agent reaches only its Project's folder, and {} is outside it.",
                asked.display()
            )));
        }
        Ok(Reach { path, inside })
    }

    /// Where it is: absolute, its links followed.
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn into_path(self) -> PathBuf {
        self.path
    }

    /// Whether it is inside the Project's folder, or is that folder.
    pub fn inside(&self) -> bool {
        self.inside
    }
}

/// Why a path cannot be read as the system reads it.
enum Amiss {
    /// A folder on the way is not there, and `..` goes past it.
    Missing,
    /// A link that leads nowhere, which an Agent may not write through.
    Dangling,
}

impl Amiss {
    fn refusal(self, asked: &Path) -> Refusal {
        let asked = asked.display();
        match self {
            Amiss::Missing => {
                Refusal::not_found(format!("{asked} goes through a folder that is not there."))
            }
            Amiss::Dangling => Refusal::forbidden(format!("{asked} is a link that leads nowhere.")),
        }
    }
}

/// `path`, absolute, as the system reads it: the nearest part of it that
/// is there, its links and `..` followed, and the names after it that are
/// not there yet.
fn real(path: &Path, walled: bool) -> Result<PathBuf, Amiss> {
    let mut missing: Vec<OsString> = Vec::new();
    let mut at = path;
    loop {
        if at.symlink_metadata().is_ok() {
            match at.canonicalize() {
                Ok(found) => {
                    return Ok(missing
                        .iter()
                        .rev()
                        .fold(found, |path, name| path.join(name)));
                }
                // A link to nothing: the Person names the link itself.
                Err(_) if !walled => {}
                Err(_) => return Err(Amiss::Dangling),
            }
        }
        let (Some(parent), Some(name)) = (at.parent(), at.file_name()) else {
            return Err(Amiss::Missing);
        };
        missing.push(name.to_owned());
        at = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Code;

    /// A Project's folder, `work`, beside a folder outside it, `other`.
    fn places() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().canonicalize().unwrap();
        let (work, other) = (base.join("work"), base.join("other"));
        std::fs::create_dir_all(work.join("src")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(work.join("src/main.rs"), "").unwrap();
        std::fs::write(other.join("secret.txt"), "").unwrap();
        (root, work, other)
    }

    #[test]
    fn a_relative_path_starts_at_the_projects_folder() {
        let (_root, work, _) = places();
        let reach = Reach::resolve(&work, "src/main.rs", true).unwrap();
        assert_eq!(reach.path(), work.join("src/main.rs"));
        assert!(reach.inside());
        let reach = Reach::resolve(&work, "", true).unwrap();
        assert_eq!(reach.path(), work);
        assert!(reach.inside());
    }

    #[test]
    fn the_person_reaches_any_path() {
        let (_root, work, other) = places();
        let reach = Reach::resolve(&work, other.join("secret.txt"), false).unwrap();
        assert_eq!(reach.path(), other.join("secret.txt"));
        assert!(!reach.inside());
        let reach = Reach::resolve(&work, "../other", false).unwrap();
        assert_eq!(reach.path(), other);
    }

    #[test]
    fn an_agent_is_held_inside_the_projects_folder() {
        let (_root, work, other) = places();
        let refused = Reach::resolve(&work, other.join("secret.txt"), true).unwrap_err();
        assert_eq!(refused.code, Code::Forbidden);
        assert!(refused.message.contains("outside"), "{}", refused.message);
        // An absolute path inside is fine.
        assert!(Reach::resolve(&work, work.join("src"), true).is_ok());
    }

    #[test]
    fn dot_dot_that_leaves_the_folder_is_refused_and_one_that_stays_is_not() {
        let (_root, work, _) = places();
        for asked in [
            "..",
            "../other/secret.txt",
            "src/../../other",
            "new/../../x",
        ] {
            let refused = Reach::resolve(&work, asked, true).unwrap_err();
            assert!(
                matches!(refused.code, Code::Forbidden | Code::NotFound),
                "{asked}: {refused:?}"
            );
        }
        let reach = Reach::resolve(&work, "src/../src/main.rs", true).unwrap();
        assert_eq!(reach.path(), work.join("src/main.rs"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leads_out_of_the_folder_is_refused() {
        let (_root, work, other) = places();
        std::os::unix::fs::symlink(&other, work.join("out")).unwrap();
        std::os::unix::fs::symlink(other.join("secret.txt"), work.join("leak.txt")).unwrap();
        for asked in ["out", "out/secret.txt", "leak.txt", "out/new.txt"] {
            let refused = Reach::resolve(&work, asked, true).unwrap_err();
            assert_eq!(refused.code, Code::Forbidden, "{asked}");
        }
        // The Person follows it.
        let reach = Reach::resolve(&work, "out/secret.txt", false).unwrap();
        assert_eq!(reach.path(), other.join("secret.txt"));
        assert!(!reach.inside());
        // A link inside that stays inside is fine.
        std::os::unix::fs::symlink(work.join("src"), work.join("code")).unwrap();
        let reach = Reach::resolve(&work, "code/main.rs", true).unwrap();
        assert_eq!(reach.path(), work.join("src/main.rs"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_nothing_is_no_way_through_for_an_agent() {
        let (_root, work, other) = places();
        std::os::unix::fs::symlink(other.join("gone.txt"), work.join("dangling")).unwrap();
        let refused = Reach::resolve(&work, "dangling", true).unwrap_err();
        assert_eq!(refused.code, Code::Forbidden);
        let reach = Reach::resolve(&work, "dangling", false).unwrap();
        assert_eq!(reach.path(), work.join("dangling"));
    }

    #[test]
    fn a_path_not_there_yet_is_read_through_its_folder() {
        let (_root, work, _) = places();
        let reach = Reach::resolve(&work, "src/new/deeper.txt", true).unwrap();
        assert_eq!(reach.path(), work.join("src/new/deeper.txt"));
        assert!(reach.inside());
    }
}
