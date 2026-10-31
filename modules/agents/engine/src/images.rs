//! The bytes of the images messages carry, as files in the Space:
//! `.bandaso/images/<image ID>`. The Space's SQLite keeps what each image
//! is and which message carries it (`store`); the bytes stay out of it
//! (ADR 0002, decision 1), and copying the Space's folder moves them too.
//!
//! A file is written before its image's row commits, so a file may have
//! no row: an attach that failed, or one repeated with the same command.
//! The sweep lets such files go once they are a day old.

use crate::model::ImageId;
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// How long an image waits for the message it was added for.
pub const UNSENT_LAST: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone)]
pub struct Images {
    folder: PathBuf,
}

impl Images {
    /// The images of the Space in `space`.
    pub fn of(space: &Path) -> Self {
        Images {
            folder: space.join(".bandaso").join("images"),
        }
    }

    /// Keeps an image's bytes, whole or not at all.
    pub async fn keep(&self, image: ImageId, bytes: Vec<u8>) -> io::Result<()> {
        let (folder, path) = (self.folder.clone(), self.path(image));
        blocking(move || {
            std::fs::create_dir_all(&folder)?;
            let part = path.with_extension("part");
            std::fs::write(&part, bytes)?;
            std::fs::rename(part, path)
        })
        .await
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
            let entries = match std::fs::read_dir(&folder) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
                entries => entries?,
            };
            let before = SystemTime::now() - UNSENT_LAST;
            for entry in entries {
                let entry = entry?;
                let name = entry.file_name();
                let named = name
                    .to_str()
                    .and_then(|name| name.parse::<ImageId>().ok())
                    .is_some_and(|image| known.contains(&image));
                if !named && entry.metadata()?.modified()? < before {
                    remove(&entry.path())?;
                }
            }
            Ok(())
        })
        .await
    }

    fn path(&self, image: ImageId) -> PathBuf {
        self.folder.join(image.to_string())
    }
}

fn remove(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        done => done,
    }
}

async fn blocking<T: Send + 'static>(
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
        let space = tempfile::tempdir().unwrap();
        let images = Images::of(space.path());
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
