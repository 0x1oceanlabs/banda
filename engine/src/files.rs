//! `banda files [path]`: Files in Banda's window, on a folder (ADR 0073,
//! decision 1). It opens a `files.tree` Pane through `workspaces.open`, as
//! the window shows every Pane the workspaces hold; a file opens its folder
//! with it picked.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_kernel::{CommandId, ProjectId, ProjectSummary, Refusal};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Opens Files on `path`, or where this runs, in `project`, or else in the
/// Project whose folder holds it, else the first one.
pub async fn open(
    places: &Places,
    path: Option<PathBuf>,
    project: Option<ProjectId>,
) -> Result<(), Failure> {
    let (dir, selected) = shown(path.unwrap_or_else(|| PathBuf::from(".")))?;
    let mut client = Client::connect(places).await?;
    let project = match project {
        Some(project) => project,
        None => {
            let listed = (client.call("projects.list", None, CommandId::new(), json!({}))).await?;
            let projects: Vec<ProjectSummary> =
                serde_json::from_value(listed).map_err(Failure::broken)?;
            pick(&projects, &dir).ok_or_else(|| {
                Failure::Refused(Refusal::not_found(
                    "Banda has no Project yet: add one with banda project add.",
                ))
            })?
        }
    };
    let args = json!({
        "dir": dir.display().to_string(),
        "selected": selected.map_or(Value::Null, Value::from),
    });
    // As by a key, from the Pane of the terminal this runs in, where it
    // runs in one, so it lands where that key would there (ADR 0134,
    // decision 4). An Agent's pass is refused it, whatever Pane it names:
    // an Agent opens through `open_pane`, which takes no `files.tree` yet.
    let params = json!({
        "project": project, "kind": "files.tree", "args": args,
        "from": banda_kernel::pane_from_env(), "via": "key",
    });
    let opened = (client.call("workspaces.open", None, CommandId::new(), params)).await?;
    println!("{}", json!({ "ok": opened }));
    Ok(())
}

/// The folder Files shows for `path`, whole, and the file it picks in it:
/// a folder's own, or a file's folder and the file.
fn shown(path: PathBuf) -> Result<(PathBuf, Option<String>), Failure> {
    let path = match path.strip_prefix("~") {
        Ok(rest) => dirs::home_dir()
            .ok_or_else(|| Failure::broken("This user has no home folder."))?
            .join(rest),
        Err(_) => path,
    };
    let whole = dunce::canonicalize(&path).map_err(|_| {
        Failure::Refused(Refusal::not_found(format!(
            "{} is not there.",
            path.display()
        )))
    })?;
    if whole.is_dir() {
        return Ok((whole, None));
    }
    let name = whole
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    let dir = whole
        .parent()
        .map_or_else(|| PathBuf::from("/"), Path::to_path_buf);
    Ok((dir, name))
}

/// The Project whose folder holds `dir`, the nearest; else the first
/// shown, a pinned one first. Archived ones and No Project's are passed
/// over.
fn pick(projects: &[ProjectSummary], dir: &Path) -> Option<ProjectId> {
    let shown = || projects.iter().filter(|p| !p.archived && !p.scratch);
    // As the system names it, as `dir` is, where it is there.
    let real =
        |p: &ProjectSummary| dunce::canonicalize(&p.folder).unwrap_or(p.folder.clone().into());
    let holding = shown()
        .filter(|p| banda_kernel::host::within(dir, &real(p)))
        .max_by_key(|p| real(p).as_os_str().len());
    holding
        .or_else(|| shown().find(|p| p.pinned))
        .or_else(|| shown().next())
        .map(|p| p.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, folder: &str, pinned: bool) -> ProjectSummary {
        serde_json::from_value(json!({
            "id": ProjectId::new(),
            "name": name,
            "folder": folder,
            "pinned": pinned,
            "archived": false,
            "sees_others": false,
            "scratch": false,
            "missing": false,
            "sign": { "kind": "letters", "text": name[..1].to_uppercase(), "picked": false },
            "trusted": true,
        }))
        .unwrap()
    }

    #[test]
    fn the_nearest_project_holding_the_folder_shows_it_else_a_pinned_one() {
        let code = project("code", "/home/r/code", false);
        let banda = project("banda", "/home/r/code/banda", false);
        let notes = project("notes", "/home/r/notes", true);
        let all = [code.clone(), banda.clone(), notes.clone()];
        assert_eq!(
            pick(&all, Path::new("/home/r/code/banda/src")),
            Some(banda.id)
        );
        assert_eq!(pick(&all, Path::new("/home/r/code/other")), Some(code.id));
        assert_eq!(pick(&all, Path::new("/srv")), Some(notes.id));
        assert_eq!(pick(&[], Path::new("/srv")), None);
    }

    #[test]
    fn a_file_shows_its_folder_with_it_picked() {
        let root = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(root.path()).unwrap();
        std::fs::write(folder.join("a.md"), "").unwrap();
        assert_eq!(shown(folder.clone()).ok(), Some((folder.clone(), None)));
        assert_eq!(
            shown(folder.join("a.md")).ok(),
            Some((folder.clone(), Some("a.md".to_owned())))
        );
        assert!(shown(folder.join("gone")).is_err());
    }
}
