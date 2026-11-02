//! The files Banda keeps for messages to point at (ADR 0015, decision 5):
//! a file dropped on a Thread, or a long text pasted, is copied into the
//! Space as `.banda/files/<ID>/<name>`, and the message names it as
//! `@path`, as it names a file of the Space's own. An Agent reads it as it
//! reads any file, only as far as it needs to. Copying the Space's folder
//! moves them too.

use crate::images::write_whole;
use banda_kernel::DATA;
use std::io;
use std::path::Path;

/// Keeps `bytes` as a file named `name` in the Space in `space`, whole or
/// not at all; answers its path in the Space, as a message writes it.
pub async fn keep(space: &Path, name: String, bytes: Vec<u8>) -> io::Result<String> {
    let path = format!("{DATA}/files/{}/{name}", uuid::Uuid::now_v7());
    write_whole(space.join(&path), bytes).await?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_kept_file_is_in_the_spaces_banda_folder_by_its_name() {
        let space = tempfile::tempdir().unwrap();
        let path = keep(space.path(), "notes.md".into(), b"# hi".to_vec())
            .await
            .unwrap();
        assert!(path.starts_with(&format!("{DATA}/files/")));
        assert!(path.ends_with("/notes.md"));
        let folder = space.path().join(&path);
        assert_eq!(std::fs::read(&folder).unwrap(), b"# hi");
        let parent = folder.parent().unwrap();
        assert_eq!(std::fs::read_dir(parent).unwrap().count(), 1);
    }
}
