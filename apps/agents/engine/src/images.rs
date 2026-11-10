//! The bytes of images carried by messages and tools, in the Project's data:
//! `projects/<id>/images/<image ID>` (ADR 0026). The Project's SQLite keeps
//! what each image is and which item carries it (`store`); the bytes
//! stay out of it (ADR 0002, decision 1).
//!
//! A file is written before its image's row commits, so a file may have
//! no row: an attach that failed, or one repeated with the same command.
//! The sweep lets such files go once they are a day old.

use crate::model::{Image, ImageId};
use banda_kernel::Refusal;
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Decode only bounded images, then check their type and file signature.
/// Both message attachments and tool results use the same rules.
pub fn prepare(
    mime: String,
    data: &str,
    name: Option<String>,
) -> Result<(Image, Vec<u8>), Refusal> {
    if data.len() > crate::rules::message::LARGEST_IMAGE.div_ceil(3) * 4 {
        return Err(Refusal::invalid("An image can be at most 10 MB."));
    }
    let bytes = crate::decoded(data, "image")?;
    crate::rules::message::may_attach(&mime, &bytes)?;
    let image = Image {
        id: ImageId::new(),
        mime,
        size: bytes.len() as u32,
        name,
    };
    Ok((image, bytes))
}

/// How long an image waits for the message it was added for.
pub const UNSENT_LAST: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone)]
pub struct Images {
    folder: PathBuf,
}

impl Images {
    /// The images of the Project whose data is in `data`.
    pub fn of(data: &Path) -> Self {
        Images {
            folder: data.join("images"),
        }
    }

    /// Keeps an image's bytes, whole or not at all.
    pub async fn keep(&self, image: ImageId, bytes: Vec<u8>) -> io::Result<()> {
        write_whole(self.path(image), bytes).await
    }

    pub async fn read(&self, image: ImageId) -> io::Result<Vec<u8>> {
        let path = self.path(image);
        blocking(move || std::fs::read(path)).await
    }

    /// Lets go of the files of `gone`, and of every file a day old that
    /// `known` does not name.
    pub async fn sweep(&self, gone: Vec<ImageId>, known: HashSet<ImageId>) -> io::Result<()> {
        let folder = self.folder.clone();
        let paths: Vec<_> = gone.into_iter().map(|image| self.path(image)).collect();
        blocking(move || {
            for path in paths {
                remove(&path)?;
            }
            let_go_unnamed(&folder, |name| {
                name.parse::<ImageId>()
                    .is_ok_and(|image| known.contains(&image))
            })
        })
        .await
    }

    pub(crate) fn path(&self, image: ImageId) -> PathBuf {
        self.folder.join(image.to_string())
    }
}

/// Lets go of every file in `folder` a day old whose name `named` does not
/// take; a folder not made yet holds none.
pub(crate) fn let_go_unnamed(folder: &Path, named: impl Fn(&str) -> bool) -> io::Result<()> {
    let entries = match std::fs::read_dir(folder) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        entries => entries?,
    };
    let before = SystemTime::now() - UNSENT_LAST;
    for entry in entries {
        let entry = entry?;
        let kept = entry.file_name().to_str().is_some_and(&named);
        if !kept && entry.metadata()?.modified()? < before {
            remove(&entry.path())?;
        }
    }
    Ok(())
}

pub(crate) fn remove(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        done => done,
    }
}

/// Writes `bytes` as the file at `path`, whole or not at all: beside it
/// first, then into its place, its folder made if it is not there.
pub async fn write_whole(path: PathBuf, bytes: Vec<u8>) -> io::Result<()> {
    blocking(move || {
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        let part = path.with_extension("part");
        std::fs::write(&part, bytes)?;
        banda_kernel::host::rename(&part, &path)
    })
    .await
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> io::Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(io::Error::other)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_image_is_kept_read_and_let_go() {
        let project = tempfile::tempdir().unwrap();
        let images = Images::of(project.path());
        let (kept, gone) = (ImageId::new(), ImageId::new());
        images.keep(kept, b"one".to_vec()).await.unwrap();
        images.keep(gone, b"two".to_vec()).await.unwrap();
        assert_eq!(images.read(kept).await.unwrap(), b"one");

        images.sweep(vec![gone], HashSet::new()).await.unwrap();
        assert!(images.read(gone).await.is_err());
        assert!(
            images.read(kept).await.is_ok(),
            "a fresh file waits its day"
        );
    }
}
