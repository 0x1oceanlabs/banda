//! The pages an Agent shows its Person in its Thread (ADR 0037): each one
//! a file in the Space's data, `spaces/<id>/visuals/<visual ID>.html`,
//! named by its Thread item, `Body::Visual`. The window serves it at
//! `app://visuals/<space>/<visual>`, in a frame kept apart from Banda.
//!
//! The file is written before its item commits; a show the engine refuses
//! after takes its file back. A fork's items name the same files. A file
//! no item names, as after a rewind, goes with the sweep once a day old,
//! as an image no message took does.

use crate::images::{blocking, let_go_unnamed, remove, write_whole};
use crate::model::VisualId;
use banda_kernel::Refusal;
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

/// The longest page a Visual takes, in characters, as T3 Code's.
pub const LONGEST: usize = 512_000;
/// The longest title, in characters.
pub const TITLE: usize = 200;
/// How tall an Agent may say its Visual is, in pixels; the frame then
/// fits the page's own height.
pub const LOWEST: u32 = 80;
pub const HIGHEST: u32 = 2_000;

#[derive(Clone)]
pub struct Visuals {
    folder: PathBuf,
}

impl Visuals {
    /// The Visuals of the Space whose data is in `data`.
    pub fn of(data: &Path) -> Self {
        Visuals {
            folder: data.join("visuals"),
        }
    }

    /// Keeps a page, whole or not at all.
    pub async fn keep(&self, visual: VisualId, html: String) -> io::Result<()> {
        write_whole(self.path(visual), html.into_bytes()).await
    }

    pub async fn read(&self, visual: VisualId) -> io::Result<String> {
        let path = self.path(visual);
        blocking(move || std::fs::read_to_string(path)).await
    }

    /// Lets a page go that no item came to name.
    pub async fn forget(&self, visual: VisualId) {
        let path = self.path(visual);
        if let Err(error) = blocking(move || remove(&path)).await {
            tracing::warn!(%error, %visual, "could not let go of a Visual no item took");
        }
    }

    /// Lets go of every page a day old that no item in `named` names.
    pub async fn sweep(&self, named: HashSet<VisualId>) -> io::Result<()> {
        let folder = self.folder.clone();
        blocking(move || {
            let_go_unnamed(&folder, |name| {
                name.strip_suffix(".html")
                    .and_then(|id| id.parse::<VisualId>().ok())
                    .is_some_and(|visual| named.contains(&visual))
            })
        })
        .await
    }

    fn path(&self, visual: VisualId) -> PathBuf {
        self.folder.join(format!("{visual}.html"))
    }
}

/// How wide the check lays a page out, in pixels: T3 Code's widths, a
/// Thread's reply by default.
pub const NARROWEST: u32 = 240;
pub const WIDEST: u32 = 1_600;
pub const WIDTH: u32 = 728;

/// What an Agent may show: a page of up to [`LONGEST`] characters, with a
/// title. It answers the title trimmed and cut at [`TITLE`], and the
/// height brought within [`LOWEST`] and [`HIGHEST`].
pub fn may_show(html: &str, title: &str, height: u32) -> Result<(String, u32), Refusal> {
    may_lay_out(html)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(Refusal::invalid("A Visual needs a title."));
    }
    Ok((
        title.chars().take(TITLE).collect(),
        height.clamp(LOWEST, HIGHEST),
    ))
}

/// What the check lays out: a page as [`may_show`] takes it.
pub fn may_lay_out(html: &str) -> Result<(), Refusal> {
    if html.trim().is_empty() {
        return Err(Refusal::invalid(
            "A Visual needs its page: a whole HTML document.",
        ));
    }
    let long = html.chars().count();
    if long > LONGEST {
        return Err(Refusal::invalid(format!(
            "The page has {long} characters; a Visual takes {LONGEST} at most."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "<!doctype html><p>Hi</p>";

    #[test]
    fn a_visual_is_a_page_with_a_title_and_a_height_in_bounds() {
        assert_eq!(
            may_show(PAGE, "  A mockup ", 20).unwrap(),
            ("A mockup".to_owned(), 80)
        );
        assert_eq!(may_show(PAGE, "t", 9_000).unwrap().1, 2_000);
        let long = "x".repeat(300);
        assert_eq!(may_show(PAGE, &long, 300).unwrap().0.len(), TITLE);
    }

    #[test]
    fn a_visual_with_no_page_or_title_or_too_long_a_page_is_refused() {
        assert_eq!(
            may_show(" ", "t", 300).unwrap_err().message,
            "A Visual needs its page: a whole HTML document."
        );
        assert_eq!(
            may_show(PAGE, " ", 300).unwrap_err().message,
            "A Visual needs a title."
        );
        let long = "x".repeat(LONGEST + 1);
        assert_eq!(
            may_show(&long, "t", 300).unwrap_err().message,
            "The page has 512001 characters; a Visual takes 512000 at most."
        );
    }

    #[tokio::test]
    async fn a_page_is_kept_read_and_let_go() {
        let data = tempfile::tempdir().unwrap();
        let visuals = Visuals::of(data.path());
        let (named, other) = (VisualId::new(), VisualId::new());
        visuals.keep(named, PAGE.into()).await.unwrap();
        visuals.keep(other, PAGE.into()).await.unwrap();
        assert_eq!(visuals.read(named).await.unwrap(), PAGE);
        visuals.forget(other).await;
        assert!(visuals.read(other).await.is_err());
        visuals.sweep(HashSet::new()).await.unwrap();
        assert!(
            visuals.read(named).await.is_ok(),
            "a fresh page waits its day"
        );
    }
}
