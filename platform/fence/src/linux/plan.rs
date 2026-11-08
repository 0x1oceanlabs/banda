//! What a spec comes to as mounts, before the launcher makes any: which
//! folders it covers, which holes it opens back and how, and which
//! folders above them it pins.

use crate::Spec;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

/// How a hole opens, and what its mount may do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum May {
    Write,
    Read,
    Run,
}

/// A spec's mounts, checked.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    /// What it covers that must be there, none inside another.
    pub hidden: Vec<PathBuf>,
    /// What it covers when it is there, none inside what else it covers.
    pub hidden_if_there: Vec<PathBuf>,
    /// What it keeps read-only, none inside what it covers.
    pub read_only: Vec<PathBuf>,
    /// The folders whose files it gives as copies of the user's own, none
    /// inside what it covers.
    pub owned: Vec<PathBuf>,
    /// The holes inside what it covers, each before any inside it.
    pub holes: Vec<(PathBuf, May)>,
}

/// The mounts `spec` asks for, or why it cannot be met. A hole outside
/// everything hidden is in sight already, and is no hole.
pub(crate) fn plan(spec: &Spec) -> Result<Plan, String> {
    let named = (spec.hidden.iter())
        .chain(&spec.hidden_if_there)
        .chain(&spec.hidden_starting)
        .chain(&spec.read_only)
        .chain(&spec.owned)
        .chain(&spec.holes.writes)
        .chain(&spec.holes.reads)
        .chain(&spec.holes.runs)
        .chain(&spec.cwd);
    for path in named {
        plain(path)?;
    }
    let hidden = outermost(&spec.hidden);
    let covered = |path: &Path| hidden.iter().any(|root| path.starts_with(root));
    let hidden_if_there: Vec<PathBuf> = outermost(&spec.hidden_if_there)
        .into_iter()
        .filter(|path| !covered(path))
        .collect();
    let mut read_only = outermost(&spec.read_only);
    if let Some(inside) = read_only.iter().find(|path| covered(path)) {
        return Err(format!(
            "{} is to be read-only inside a folder the fence hides",
            inside.display()
        ));
    }
    read_only.sort();
    let owned: Vec<PathBuf> = outermost(&spec.owned)
        .into_iter()
        .filter(|path| !covered(path))
        .collect();

    let asked = [
        (&spec.holes.writes, May::Write),
        (&spec.holes.reads, May::Read),
        (&spec.holes.runs, May::Run),
    ];
    let hides =
        |path: &Path| (spec.hidden.iter().chain(&spec.hidden_if_there)).any(|root| root == path);
    let mut holes: Vec<(PathBuf, May)> = Vec::new();
    for (paths, may) in asked {
        for path in paths {
            if hides(path) {
                return Err(format!(
                    "{} is a hole as wide as what the fence hides",
                    path.display()
                ));
            }
            if let Some(maybe) = (spec.hidden_if_there.iter()).find(|root| path.starts_with(root)) {
                return Err(format!(
                    "the hole {} is in {}, which the fence hides only when it is there",
                    path.display(),
                    maybe.display()
                ));
            }
            if !covered(path) {
                continue;
            }
            // Every folder the spec hides, even one inside another.
            let uncovers = (spec.hidden.iter().chain(&spec.hidden_if_there))
                .find(|root| root.starts_with(path) && *root != path);
            if let Some(uncovered) = uncovers {
                return Err(format!(
                    "the hole {} would show {}, which the fence hides",
                    path.display(),
                    uncovered.display()
                ));
            }
            // Each hole is put where it is through the fence's own empty
            // folder, never through another hole's.
            let nested = (holes.iter()).find(|(other, _)| {
                other != path && (path.starts_with(other) || other.starts_with(path))
            });
            if let Some((other, _)) = nested {
                return Err(format!(
                    "the holes {} and {} are one inside the other",
                    path.display(),
                    other.display()
                ));
            }
            holes.push((path.clone(), may));
        }
    }
    holes.sort_by(|(a, _), (b, _)| depth(a).cmp(&depth(b)).then(a.cmp(b)));
    holes.dedup_by(|(a, _), (b, _)| a == b);
    Ok(Plan {
        hidden,
        hidden_if_there,
        read_only,
        owned,
        holes,
    })
}

/// `path` as the launcher takes it: absolute, with no `.` or `..` in it,
/// and not the root.
fn plain(path: &Path) -> Result<(), String> {
    // As written: `components` reads `/a/./b` as `/a/b`.
    let parts = path.as_os_str().as_bytes().split(|byte| *byte == b'/');
    let odd = parts.into_iter().any(|part| part == b"." || part == b"..");
    if !path.is_absolute() || odd || path.parent().is_none() {
        return Err(format!(
            "{} is not an absolute path to a folder below the root",
            path.display()
        ));
    }
    Ok(())
}

/// `paths` but those inside another of them, sorted.
fn outermost(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut kept: Vec<PathBuf> = Vec::new();
    let mut sorted = paths.to_vec();
    sorted.sort_by(|a, b| depth(a).cmp(&depth(b)).then(a.cmp(b)));
    for path in sorted {
        if !kept.iter().any(|outer| path.starts_with(outer)) {
            kept.push(path);
        }
    }
    kept.sort();
    kept
}

/// How many parts `path` has.
fn depth(path: &Path) -> usize {
    path.components().count()
}

/// The folders above `roots` to pin where they are, so each root stays
/// where the engine looks for it: each one above a root that the user may
/// rename (`renamable`), up to the root of all, outermost first. A folder
/// pinned is a mount of itself, which nothing in the fence may rename; a
/// root is one already.
pub(crate) fn pins<'a>(
    roots: impl IntoIterator<Item = &'a Path>,
    renamable: impl Fn(&Path) -> bool,
) -> Vec<PathBuf> {
    let roots: Vec<&Path> = roots.into_iter().collect();
    let mut pins: Vec<PathBuf> = Vec::new();
    for root in &roots {
        for folder in root.ancestors().skip(1) {
            let pinned = roots.contains(&folder) || pins.iter().any(|pin| pin == folder);
            if folder.parent().is_some() && !pinned && renamable(folder) {
                pins.push(folder.to_path_buf());
            }
        }
    }
    pins.sort_by(|a, b| depth(a).cmp(&depth(b)).then(a.cmp(b)));
    pins
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Holes;

    fn paths(said: &[&str]) -> Vec<PathBuf> {
        said.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn what_is_inside_what_the_fence_covers_is_covered_with_it() {
        let spec = Spec {
            hidden: paths(&["/h/s/banda", "/h/s/banda/logs", "/r"]),
            hidden_if_there: paths(&["/r/docker.sock", "/tmp/.X11-unix"]),
            ..Spec::default()
        };
        let plan = plan(&spec).unwrap();
        assert_eq!(plan.hidden, paths(&["/h/s/banda", "/r"]));
        assert_eq!(plan.hidden_if_there, paths(&["/tmp/.X11-unix"]));
    }

    #[test]
    fn a_hole_opens_only_inside_what_is_hidden_and_never_uncovers_more() {
        let spec = Spec {
            hidden: paths(&["/d/banda", "/d/banda-dev"]),
            holes: Holes {
                writes: paths(&["/d/banda/p/a/sessions/claude", "/home/p/Banda/a"]),
                reads: paths(&["/d/banda/p/a/files"]),
                runs: paths(&["/d/banda/engine/1.0"]),
            },
            ..Spec::default()
        };
        let plan = plan(&spec).unwrap();
        assert_eq!(
            plan.holes,
            [
                (PathBuf::from("/d/banda/engine/1.0"), May::Run),
                (PathBuf::from("/d/banda/p/a/files"), May::Read),
                (PathBuf::from("/d/banda/p/a/sessions/claude"), May::Write),
            ]
        );

        let wide = Spec {
            hidden: paths(&["/d/banda"]),
            holes: Holes {
                writes: paths(&["/d/banda"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert!(plan_error(&wide).contains("as wide as"));

        let over = Spec {
            hidden: paths(&["/d/banda", "/d/banda/p/a/secret"]),
            hidden_if_there: paths(&["/d/banda/p/b/x.sock"]),
            holes: Holes {
                writes: paths(&["/d/banda/p"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert!(plan_error(&over).contains("would show /d/banda/p/a/secret"));
    }

    #[test]
    fn a_hole_beside_another_hidden_folder_or_outside_them_all_is_no_trouble() {
        let spec = Spec {
            hidden: paths(&["/d/banda", "/d/other"]),
            hidden_if_there: paths(&["/d/sock"]),
            holes: Holes {
                writes: paths(&["/d/banda/x"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert_eq!(plan(&spec).unwrap().holes.len(), 1);
        let spec = Spec {
            hidden: paths(&["/x/banda", "/x/banda-dev/hidden"]),
            holes: Holes {
                reads: paths(&["/x/banda-dev"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        // Outside what is hidden, it is no hole: nothing to refuse.
        assert!(plan(&spec).unwrap().holes.is_empty());
    }

    #[test]
    fn a_read_only_folder_inside_a_hidden_one_and_odd_paths_are_refused() {
        let inside = Spec {
            hidden: paths(&["/s/banda"]),
            read_only: paths(&["/s/banda/config"]),
            ..Spec::default()
        };
        assert!(plan_error(&inside).contains("read-only inside"));
        for odd in ["relative/banda", "/a/../b", "/a/./b", "/"] {
            let spec = Spec {
                hidden: paths(&[odd]),
                ..Spec::default()
            };
            assert!(plan_error(&spec).contains("not an absolute path"), "{odd}");
        }
    }

    #[test]
    fn a_folder_given_as_the_users_own_copies_is_one_outside_what_is_hidden() {
        let spec = Spec {
            hidden: paths(&["/h/s/banda"]),
            owned: paths(&[
                "/etc/ssh/ssh_config.d",
                "/h/s/banda/ssh",
                "/etc/ssh/ssh_config.d/x",
            ]),
            ..Spec::default()
        };
        assert_eq!(
            plan(&spec).unwrap().owned,
            paths(&["/etc/ssh/ssh_config.d"])
        );
        let odd = Spec {
            owned: paths(&["etc/ssh"]),
            ..Spec::default()
        };
        assert!(plan_error(&odd).contains("not an absolute path"));
    }

    fn plan_error(spec: &Spec) -> String {
        plan(spec).unwrap_err()
    }

    #[test]
    fn every_folder_above_a_root_the_user_may_rename_is_pinned_outermost_first() {
        // The user may rename what is under its home, not the home itself.
        let home = Path::new("/home/p");
        let renamable = |folder: &Path| {
            (folder.starts_with(home) && folder != home) || folder == Path::new("/tmp/t")
        };
        let roots = paths(&[
            "/home/p/.local/state/banda",
            "/home/p/.local/share/banda",
            "/home/p/.config/banda",
            "/run/user/1000",
            "/tmp/t/state",
        ]);
        let pinned = pins(roots.iter().map(PathBuf::as_path), renamable);
        assert_eq!(
            pinned,
            paths(&[
                "/tmp/t",
                "/home/p/.config",
                "/home/p/.local",
                "/home/p/.local/share",
                "/home/p/.local/state",
            ])
        );
    }

    #[test]
    fn a_folder_the_user_may_not_rename_does_not_stop_the_pins_above_it() {
        // `kept` may not be renamed, but the folder it is in may, and takes
        // it along.
        let renamable = |folder: &Path| folder == Path::new("/home/p/moves");
        let roots = paths(&["/home/p/moves/kept/banda"]);
        let pinned = pins(roots.iter().map(PathBuf::as_path), renamable);
        assert_eq!(pinned, paths(&["/home/p/moves"]));
    }

    #[test]
    fn a_root_above_another_is_no_pin_and_nothing_is_pinned_twice() {
        let roots = paths(&["/h/a/b", "/h/a", "/h/a/c"]);
        let pinned = pins(roots.iter().map(PathBuf::as_path), |_| true);
        assert_eq!(pinned, paths(&["/h"]));
    }

    #[test]
    fn holes_are_neither_one_inside_another_nor_where_the_fence_hides_only_maybe() {
        let nested = Spec {
            hidden: paths(&["/d/banda"]),
            holes: Holes {
                writes: paths(&["/d/banda/p"]),
                reads: paths(&["/d/banda/p/y/x"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert!(plan_error(&nested).contains("one inside the other"));

        let maybe = Spec {
            hidden_if_there: paths(&["/tmp/x"]),
            holes: Holes {
                writes: paths(&["/tmp/x/a"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert!(plan_error(&maybe).contains("only when it is there"));

        let inner = Spec {
            hidden: paths(&["/d/banda", "/d/banda/inner"]),
            holes: Holes {
                reads: paths(&["/d/banda/inner"]),
                ..Holes::default()
            },
            ..Spec::default()
        };
        assert!(plan_error(&inner).contains("as wide as"));
    }
}
