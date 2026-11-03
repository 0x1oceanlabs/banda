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
use crate::rules::message::{LARGEST_IMAGE, MB};
use crate::visual_page::{grows, image_kind, named_images, with_put};
use banda_kernel::Refusal;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use std::collections::{HashMap, HashSet};
use std::io;
use std::io::Read as _;
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

/// What the check lays out: a page as [`may_show`] takes it, which does
/// not size itself by its frame.
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
    if let Some(rule) = grows(html) {
        return Err(Refusal::invalid(format!(
            "The page sizes itself by its frame ({rule}), and the frame grows to fit the page, \
             so it would grow again and again. Give it fixed pixel heights, and no vh units \
             or height: 100% on html or body."
        )));
    }
    Ok(())
}

/// The most bytes of local images a page takes, as T3 Code's; each
/// image is at most a message's largest.
const MOST_IMAGE_BYTES: usize = 25 * MB;

/// A page with its local images put in, and those it could not take,
/// each as `path: why`.
pub struct Inlined {
    pub html: String,
    pub unread: Vec<String>,
}

/// Puts the local images `html` names into it as `data:` URLs: files
/// whose first bytes say they are images, within the limits, counted at
/// each place the page names one. Any other is left as it is, and said in
/// [`Inlined::unread`]. The `Result` is only the blocking pool's.
pub async fn inlined(html: String) -> io::Result<Inlined> {
    blocking(move || Ok(inline_now(html))).await
}

fn inline_now(html: String) -> Inlined {
    let named = named_images(&html);
    if named.is_empty() {
        return Inlined {
            html,
            unread: Vec::new(),
        };
    }
    let mut taken: HashMap<&str, Result<(String, usize), String>> = HashMap::new();
    let mut unread = Vec::new();
    for one in &named {
        taken.entry(&one.path).or_insert_with(|| {
            read_image(&one.path).inspect_err(|why| unread.push(format!("{}: {why}", one.path)))
        });
    }
    let mut bytes = 0;
    let mut put = Vec::new();
    for one in &named {
        let Ok((address, size)) = &taken[one.path.as_str()] else {
            continue;
        };
        if bytes + size > MOST_IMAGE_BYTES {
            let past = format!(
                "{}: past the page's {} MiB of images",
                one.path,
                MOST_IMAGE_BYTES / MB
            );
            if unread.last() != Some(&past) {
                unread.push(past);
            }
            continue;
        }
        bytes += size;
        put.push((one.at.clone(), address.as_str()));
    }
    Inlined {
        html: with_put(&html, &put),
        unread,
    }
}

/// The image at `path` as a `data:` URL, and its size; or why not. It
/// reads a file whole only once its first bytes say it is an image.
fn read_image(path: &str) -> Result<(String, usize), String> {
    let not_found = |_| "not found".to_owned();
    let mut file = std::fs::File::open(path).map_err(not_found)?;
    let size = file.metadata().map_err(not_found)?.len();
    if size > LARGEST_IMAGE as u64 {
        return Err(format!("over {} MiB", LARGEST_IMAGE / MB));
    }
    let mut read = Vec::with_capacity(size as usize);
    (&mut file)
        .take(1024)
        .read_to_end(&mut read)
        .map_err(not_found)?;
    let kind = image_kind(&read).ok_or("not an image")?;
    file.read_to_end(&mut read).map_err(not_found)?;
    let mut address = format!("data:{kind};base64,");
    BASE64.encode_string(&read, &mut address);
    Ok((address, read.len()))
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

    #[test]
    fn local_images_go_in_within_their_limits() {
        let folder = tempfile::tempdir().unwrap();
        let image = |name: &str, size: u64| {
            let path = folder.path().join(name);
            std::fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_len(size)
                .unwrap();
            path.display().to_string()
        };
        let small = image("small.png", 16);
        let large = image("large.png", 11 * MB as u64);
        let nine: Vec<_> = (0..3)
            .map(|n| image(&format!("nine{n}.png"), 9 * MB as u64))
            .collect();
        let page = format!(
            r#"<img src="{small}"><img src="{small}"><img src="{large}"><img src="{}"><img src="{}"><img src="{}">"#,
            nine[0], nine[1], nine[2]
        );
        let Inlined { html, unread } = inline_now(page);
        assert_eq!(html.matches("data:image/png;base64,").count(), 4);
        assert_eq!(
            unread,
            [
                format!("{large}: over 10 MiB"),
                format!("{}: past the page's 25 MiB of images", nine[2]),
            ]
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
