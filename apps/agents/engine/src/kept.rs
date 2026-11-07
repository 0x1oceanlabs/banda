//! The files Banda keeps for messages to point at (ADR 0015, decision 5):
//! a file dropped on a Thread, or a long text pasted, is copied into the
//! Project's data as `projects/<id>/files/<ID>/<name>` (ADR 0026), and the
//! message names it as `@path`, by its absolute path. A Thread's session
//! has that folder as an extra root, so its Agent reads it as it reads any
//! file of the Project, only as far as it needs to.

use crate::images::write_whole;
use std::io;
use std::path::{Path, PathBuf};

/// The folder of the kept files of the Project whose data is in `data`.
pub fn folder(data: &Path) -> PathBuf {
    data.join("files")
}

/// The extra roots of a Thread's session in the Project whose data is in
/// `data`: its kept files' folder, which its Harness's process reads
/// through the fence too (ADR 0083, decision 1).
pub fn roots(data: &Path) -> Vec<PathBuf> {
    vec![folder(data)]
}

/// Keeps `bytes` as a file named `name` for the Project whose data is in
/// `data`, whole or not at all; answers its absolute path, as a message
/// writes it.
pub async fn keep(data: &Path, name: String, bytes: Vec<u8>) -> io::Result<String> {
    let path = folder(data)
        .join(uuid::Uuid::now_v7().to_string())
        .join(name);
    write_whole(path.clone(), bytes).await?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_kept_file_is_in_the_projects_data_by_its_name() {
        let data = tempfile::tempdir().unwrap();
        let path = keep(data.path(), "notes.md".into(), b"# hi".to_vec())
            .await
            .unwrap();
        assert!(Path::new(&path).starts_with(folder(data.path())));
        assert!(path.ends_with("/notes.md"));
        let folder = PathBuf::from(&path);
        assert_eq!(std::fs::read(&folder).unwrap(), b"# hi");
        let parent = folder.parent().unwrap();
        assert_eq!(std::fs::read_dir(parent).unwrap().count(), 1);
    }
}
