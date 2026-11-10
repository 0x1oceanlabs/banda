//! `files.locate`: where the paths in a reply or a terminal lead (ADR
//! 0063, decision 2), each to the file it names, if there is one, found by
//! the machine that has the files (ADR 0106). A path from the root or home
//! is that file. A relative one starts at the Project's folder, and then at
//! the root of the repository each file the Thread's tools named is in: a
//! worktree beside the Project then works too (#492). Only a file is found,
//! never a folder, and only on this machine: a path to a share is never
//! looked at (ADR 0090, decision 7), as a look sends the Person's NTLM hash
//! to its host. Nor is a path the caller may not reach: an Agent's call
//! looks only inside its Project's folder, so what it finds says nothing
//! of what is outside.

use crate::model::Located;
use crate::shown;
use banda_kernel::host::{self, on_this_machine};
use std::path::{Component, Path, PathBuf};

/// At most this many paths are looked at in one call.
const PATHS: usize = 200;
/// At most this many folders a relative path is tried in, after the
/// Project's own.
const FOLDERS: usize = 16;

/// Where a call looks: the Project's `folder`, the Person's `home`, and
/// whether the caller may look at a full path at all, which an Agent may
/// only inside the folder.
pub struct Look<'a> {
    pub folder: &'a Path,
    pub home: Option<&'a Path>,
    pub reaches: &'a dyn Fn(&Path) -> bool,
}

/// The file each of `paths` names, in their order, leaving out those that
/// name none. `worked` holds the full paths the Thread's tools named,
/// latest first.
pub fn located(look: &Look, paths: &[String], worked: &[String]) -> Vec<Located> {
    let bases = bases(look, worked);
    (paths.iter().take(PATHS))
        .filter_map(|asked| one(look, asked, &bases))
        .collect()
}

fn one(look: &Look, asked: &str, bases: &[PathBuf]) -> Option<Located> {
    if asked.is_empty() || asked.contains('\0') || url(asked) {
        return None;
    }
    let (folder, home) = (look.folder, look.home);
    let found = |base: Option<&Path>, file: PathBuf| file_in(look, asked, base, &file);
    if asked == "~" || asked.starts_with("~/") {
        let rest = asked.get(2..).unwrap_or_default().trim_start_matches('/');
        return found(None, home?.join(rest));
    }
    let path = Path::new(asked);
    if path.has_root() {
        return found(None, folder.join(path));
    }
    (std::iter::once(folder).chain(bases.iter().map(PathBuf::as_path)))
        .find_map(|base| found(Some(base), base.join(path)))
}

/// Whether `asked` is a URL, as `smb://host/share/a.ts`, and so no path
/// here: it names a share or a page, never a file of this machine's. A
/// scheme has two letters or more, as one is a Windows drive (`C://a.ts`).
fn url(asked: &str) -> bool {
    asked.split_once("://").is_some_and(|(scheme, _)| {
        scheme.len() >= 2
            && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && (scheme.chars()).all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
    })
}

/// The file at the full `joined`, if it is one, found from `base`: its
/// relative path is from the Project's folder if it is in it, else from
/// `base`, or none. A share is refused as it was named, before `//` is
/// read as `/`, and a path the caller may not reach before it is looked
/// at.
fn file_in(look: &Look, asked: &str, base: Option<&Path>, joined: &Path) -> Option<Located> {
    if !on_this_machine(joined) {
        return None;
    }
    let file = resolved(joined);
    if !(look.reaches)(&file) || !std::fs::metadata(&file).is_ok_and(|meta| meta.is_file()) {
        return None;
    }
    let folder = look.folder;
    let inside = host::within(&file, folder);
    let from = if inside { Some(folder) } else { base };
    let relative = from.map_or_else(|| file.clone(), |from| relative(from, &file));
    Some(Located {
        asked: asked.to_owned(),
        file: shown(&file),
        relative: shown(&relative),
        inside,
    })
}

/// The full `path` made whole as its words say and not as the disk has
/// it: `.` dropped, and each `..` taking the name before it, never past
/// the root. Its links are not followed, so the file keeps the name the
/// reply gave it.
fn resolved(path: &Path) -> PathBuf {
    let mut whole = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                whole.pop();
            }
            part => whole.push(part),
        }
    }
    whole
}

/// The way from the folder `from` to `to`, both whole: up to the nearest
/// folder that holds both, then down; `to` itself when none does, as on
/// another drive.
fn relative(from: &Path, to: &Path) -> PathBuf {
    let Some(shared) = from.ancestors().find(|up| host::within(to, up)) else {
        return to.to_path_buf();
    };
    let shared = shared.components().count();
    let up = from.components().count() - shared;
    let down = to.components().skip(shared);
    (std::iter::repeat_n(Component::ParentDir, up).chain(down)).collect()
}

/// The folders a relative path is tried in after the Project's: for each
/// file the tools named, latest first, the root of the repository it is
/// in, as a worktree's; its own folder when it is in none. None at or
/// above home, or right under the root, where any name might be, and none
/// the caller may not reach. The first [`PATHS`] files are looked at, so
/// a long list costs no more than a reply's paths do.
fn bases(look: &Look, worked: &[String]) -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    for file in worked.iter().take(PATHS).map(Path::new) {
        if !on_this_machine(file) {
            continue;
        }
        let Some(root) = resolved(file).parent().and_then(|at| root_of(look, at)) else {
            continue;
        };
        if !host::same(&root, look.folder) && !bases.contains(&root) {
            bases.push(root);
            if bases.len() == FOLDERS {
                break;
            }
        }
    }
    bases
}

/// The nearest folder from `at` up with a `.git` in it, among those the
/// caller reaches; `at` when there is none.
fn root_of(look: &Look, at: &Path) -> Option<PathBuf> {
    let mut up = at;
    while !beyond(look, up) {
        if up.join(".git").exists() {
            return Some(up.to_path_buf());
        }
        up = up.parent()?;
    }
    (!beyond(look, at)).then(|| at.to_path_buf())
}

/// Whether `at` is home or above it, or the root or right under it, or
/// out of the caller's reach.
fn beyond(look: &Look, at: &Path) -> bool {
    let top = at.parent().and_then(Path::parent).is_none();
    top || look.home.is_some_and(|home| host::within(home, at)) || !(look.reaches)(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Project's folder and a worktree beside it, under `code`, and a
    /// home apart, each with a file.
    struct Places {
        _root: tempfile::TempDir,
        dir: PathBuf,
        project: PathBuf,
        worktree: PathBuf,
        home: PathBuf,
    }

    fn places() -> Places {
        let root = tempfile::tempdir().unwrap();
        let dir = dunce::canonicalize(root.path()).unwrap();
        let project = dir.join("code").join("banda");
        let worktree = dir.join("code").join("worktrees").join("paths");
        let home = dir.join("home");
        for folder in [project.join("src"), worktree.join("src"), home.clone()] {
            std::fs::create_dir_all(folder).unwrap();
        }
        std::fs::write(project.join("src").join("a.ts"), "").unwrap();
        std::fs::write(worktree.join("src").join("new.ts"), "").unwrap();
        // A worktree's `.git` is a file.
        std::fs::write(worktree.join(".git"), "gitdir: elsewhere\n").unwrap();
        std::fs::write(home.join("notes.md"), "").unwrap();
        Places {
            _root: root,
            dir,
            project,
            worktree,
            home,
        }
    }

    /// The Person's look from `project`, which reaches any path.
    fn person<'a>(project: &'a Path, home: Option<&'a Path>) -> Look<'a> {
        Look {
            folder: project,
            home,
            reaches: &|_| true,
        }
    }

    fn strings<const N: usize>(paths: [&str; N]) -> Vec<String> {
        paths.map(str::to_owned).to_vec()
    }

    /// A path of `names`, with this machine's separator.
    fn named(names: &[&str]) -> String {
        shown(&names.iter().collect::<PathBuf>())
    }

    fn at(asked: &str, file: &Path, relative: &str, inside: bool) -> Located {
        Located {
            asked: asked.to_owned(),
            file: shown(file),
            relative: relative.to_owned(),
            inside,
        }
    }

    #[test]
    fn a_path_starts_at_the_projects_folder_then_where_its_tools_worked() {
        let Places {
            project,
            worktree,
            home,
            ..
        } = &places();
        // The worktree has an a.ts too, and the Project's comes first.
        std::fs::write(worktree.join("src").join("a.ts"), "").unwrap();
        let worked = [shown(&worktree.join("src").join("new.ts"))];
        let paths = strings(["src/a.ts", "src/new.ts", "src/gone.ts", "src", "~/notes.md"]);
        let notes = home.join("notes.md");
        assert_eq!(
            located(&person(project, Some(home)), &paths, &worked),
            [
                at(
                    "src/a.ts",
                    &project.join("src").join("a.ts"),
                    &named(&["src", "a.ts"]),
                    true
                ),
                at(
                    "src/new.ts",
                    &worktree.join("src").join("new.ts"),
                    &named(&["src", "new.ts"]),
                    false
                ),
                // Nothing at src/gone.ts, and a folder is no file.
                at("~/notes.md", &notes, &shown(&notes), false),
            ]
        );
        // Without a home, a path from it names nothing.
        assert_eq!(
            located(&person(project, None), &strings(["~/notes.md"]), &[]),
            []
        );
    }

    #[test]
    fn a_full_path_is_that_file_from_the_projects_folder_if_it_is_in_it() {
        let Places {
            project,
            worktree,
            home,
            ..
        } = &places();
        let inside = project.join("src").join("a.ts");
        let outside = worktree.join("src").join("new.ts");
        let paths = [shown(&inside), shown(&outside)];
        assert_eq!(
            located(&person(project, Some(home)), &paths, &[]),
            [
                at(&paths[0], &inside, &named(&["src", "a.ts"]), true),
                at(&paths[1], &outside, &paths[1], false),
            ]
        );
    }

    #[test]
    fn a_path_is_read_as_its_words_say_and_one_that_climbs_out_is_named_from_the_folder() {
        let Places {
            project,
            worktree,
            home,
            ..
        } = &places();
        let asked = strings(["../worktrees/paths/src/new.ts", "src/../src/./a.ts"]);
        let found = located(&person(project, Some(home)), &asked, &[]);
        let new = worktree.join("src").join("new.ts");
        let climbed = named(&["..", "worktrees", "paths", "src", "new.ts"]);
        assert_eq!(found[0], at(&asked[0], &new, &climbed, false));
        let a = project.join("src").join("a.ts");
        assert_eq!(found[1], at(&asked[1], &a, &named(&["src", "a.ts"]), true));
    }

    #[test]
    fn the_folders_tried_are_the_repositories_roots_below_home_and_the_roots_own_folders() {
        let Places {
            dir,
            project,
            worktree,
            home,
            ..
        } = &places();
        let loose = dir.join("code").join("loose");
        std::fs::create_dir_all(&loose).unwrap();
        let worked = [
            shown(&worktree.join("src").join("new.ts")),
            shown(&worktree.join("src").join("a.ts")),
            shown(&loose.join("x.ts")),
            "relative/x.ts".to_owned(),
        ];
        assert_eq!(
            bases(&person(project, Some(home)), &worked),
            [worktree.clone(), loose]
        );
        let worked = [shown(&home.join("x.ts")), "/tmp/x.ts".to_owned()];
        assert_eq!(
            bases(&person(project, Some(home)), &worked),
            [] as [PathBuf; 0]
        );
        // The Project's own folder is tried first already.
        std::fs::create_dir_all(project.join(".git")).unwrap();
        let worked = [shown(&project.join("src").join("a.ts"))];
        assert_eq!(
            bases(&person(project, Some(home)), &worked),
            [] as [PathBuf; 0]
        );
    }

    #[test]
    fn at_most_sixteen_folders_are_tried_from_the_first_two_hundred_files() {
        let Places {
            dir, project, home, ..
        } = &places();
        let loose = |n: usize| dir.join("code").join(format!("loose{n}"));
        let worked: Vec<String> = (0..=FOLDERS)
            .map(|n| shown(&loose(n).join("x.ts")))
            .collect();
        let tried = bases(&person(project, Some(home)), &worked);
        assert_eq!(tried, (0..FOLDERS).map(loose).collect::<Vec<_>>());
        let mut worked = vec!["relative/x.ts".to_owned(); PATHS];
        worked.push(shown(&loose(0).join("x.ts")));
        assert_eq!(
            bases(&person(project, Some(home)), &worked),
            [] as [PathBuf; 0]
        );
    }

    #[test]
    fn a_caller_looks_only_where_it_reaches_so_what_is_outside_tells_it_nothing() {
        let Places {
            dir, project, home, ..
        } = &places();
        // A repository outside the Project, named first, and one inside.
        let outside = dir.join("outside");
        std::fs::create_dir_all(outside.join(".git")).unwrap();
        let sub = project.join("sub");
        std::fs::create_dir_all(sub.join(".git")).unwrap();
        std::fs::write(sub.join("probe.txt"), "").unwrap();
        let worked = [shown(&outside.join("a")), shown(&sub.join("a"))];
        let inside = |path: &Path| host::within(path, project);
        let look = Look {
            folder: project,
            home: Some(home),
            reaches: &inside,
        };
        let asked = strings(["probe.txt", "~/notes.md"]);
        let probe = at(
            "probe.txt",
            &sub.join("probe.txt"),
            &named(&["sub", "probe.txt"]),
            true,
        );
        // Whether a file is outside or not, the one inside is found.
        let found = located(&look, &asked, &worked);
        std::fs::write(outside.join("probe.txt"), "").unwrap();
        assert_eq!(located(&look, &asked, &worked), found);
        assert_eq!(found, [probe]);
        // Nor is a repository's root above the Project's folder tried.
        std::fs::create_dir_all(dir.join("code").join(".git")).unwrap();
        let loose = project.join("loose");
        let worked = [shown(&outside.join("a")), shown(&loose.join("a"))];
        assert_eq!(bases(&look, &worked), [loose]);
    }

    #[test]
    fn at_most_two_hundred_paths_are_looked_at() {
        let Places { project, home, .. } = &places();
        let mut paths = vec!["nothing".to_owned(); PATHS - 1];
        paths.extend(strings(["src/a.ts", "src/a.ts"]));
        assert_eq!(located(&person(project, Some(home)), &paths, &[]).len(), 1);
    }

    #[test]
    fn a_url_has_a_scheme_of_two_letters_or_more_as_one_is_a_drive() {
        assert!(url("smb://host/share/a.ts") && url("git+ssh://host/a"));
        assert!(!url("C://Users/ro/a.ts") && !url("src/a.ts") && !url("1x://a"));
    }

    /// `file` as a share names it: on Windows the machine's own share of
    /// its drive, elsewhere from `//`, which Unix reads as the file
    /// itself, so a look would find it.
    fn shared(file: &Path) -> String {
        let file = shown(file);
        match cfg!(windows) {
            true => format!(r"\\localhost\{}", file.replacen(':', "$", 1)),
            false => format!("/{file}"),
        }
    }

    #[test]
    fn a_path_to_a_share_is_never_looked_at() {
        let Places {
            dir, project, home, ..
        } = &places();
        let file = project.join("src").join("a.ts");
        let found = |asked: &str, worked: &[String]| {
            let found = located(&person(project, Some(home)), &strings([asked]), worked);
            found.into_iter().map(|one| one.file).collect::<Vec<_>>()
        };
        assert_eq!(found(&shared(&file), &[]), [] as [String; 0]);
        assert_eq!(found("smb://host/share/a.ts", &[]), [] as [String; 0]);
        // On Unix `smb:` is a name a folder may have: a look under the
        // Project's folder would find a file by that URL's words.
        if cfg!(unix) {
            let there = project.join("smb:").join("host").join("share");
            std::fs::create_dir_all(&there).unwrap();
            std::fs::write(there.join("a.ts"), "").unwrap();
            assert_eq!(
                found("smb:/host/share/a.ts", &[]),
                [shown(&there.join("a.ts"))]
            );
            assert_eq!(found("smb://host/share/a.ts", &[]), [] as [String; 0]);
        }
        // Nor is the repository a share's file is in tried.
        let elsewhere = dir.join("elsewhere");
        std::fs::create_dir_all(elsewhere.join(".git")).unwrap();
        std::fs::write(elsewhere.join("b.ts"), "").unwrap();
        let b = elsewhere.join("b.ts");
        assert_eq!(found("b.ts", &[shown(&b)]), [shown(&b)]);
        let worked = [shared(&b), format!("smb://host{}", shown(&b))];
        assert_eq!(found("b.ts", &worked), [] as [String; 0]);
    }
}
