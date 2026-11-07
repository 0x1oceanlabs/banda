//! What the engine reads in a Visual's page before it lays it out or
//! keeps it (ADR 0037, decisions 2 and 4): rules that size the page by
//! its frame, which the frame then grows to fit again and again, and the
//! local images the page names by an absolute path, which go into the
//! page as `data:` URLs. It reads the page's styles (`<style>` and
//! `style="…"`) and its tags' attributes, never its scripts or text, so
//! a page that only speaks of `100vh` is not refused. Pure: visuals.rs
//! reads the files.

use std::ops::Range;

/// A stretch of the page's styles, and the tag a `style="…"` is on.
struct Sheet {
    at: Range<usize>,
    /// The tag of an element's own style; none for a `<style>` sheet.
    on: Option<String>,
}

/// The page, read once: its styles, and where its scripts are.
struct Read<'a> {
    html: &'a str,
    lower: String,
    sheets: Vec<Sheet>,
    scripts: Vec<Range<usize>>,
}

impl<'a> Read<'a> {
    fn of(html: &'a str) -> Self {
        let lower = html.to_ascii_lowercase();
        let blocks = |tag: &str| {
            let (open, close) = (format!("<{tag}"), format!("</{tag}"));
            let mut found = Vec::new();
            let mut at = 0;
            while let Some(start) = lower[at..].find(&open).map(|i| at + i) {
                let Some(body) = lower[start..].find('>').map(|i| start + i + 1) else {
                    break;
                };
                let end = lower[body..].find(&close).map_or(lower.len(), |i| body + i);
                found.push(body..end);
                at = end;
            }
            found
        };
        let scripts = blocks("script");
        let sheets = blocks("style")
            .into_iter()
            .map(|at| Sheet { at, on: None })
            .collect();
        let mut page = Read {
            html,
            lower,
            sheets,
            scripts,
        };
        let own: Vec<Sheet> = page
            .attributes("style")
            .into_iter()
            .map(|(at, tag)| Sheet { at, on: Some(tag) })
            .collect();
        page.sheets.extend(own);
        page
    }

    fn in_script_or_sheet(&self, at: usize) -> bool {
        self.scripts.iter().any(|script| script.contains(&at))
            || self.sheets.iter().any(|sheet| sheet.at.contains(&at))
    }

    /// Each value of the attribute `name` outside scripts and sheets, and
    /// the tag it is on.
    fn attributes(&self, name: &str) -> Vec<(Range<usize>, String)> {
        let lower = &self.lower;
        let mut found = Vec::new();
        let mut at = 0;
        while let Some(start) = lower[at..].find(name).map(|i| at + i) {
            at = start + name.len();
            let word = lower[..start].ends_with(|c: char| c.is_ascii_whitespace());
            let Some(value) = lower[at..].trim_start().strip_prefix('=') else {
                continue;
            };
            if !word || self.in_script_or_sheet(start) {
                continue;
            }
            let Some(range) = value_at(self.html, lower.len() - value.len()) else {
                continue;
            };
            let tag = lower[..start].rfind('<').map_or("", |open| {
                let name = &lower[open + 1..start];
                &name[..name
                    .find(|c: char| !c.is_ascii_alphanumeric())
                    .unwrap_or(name.len())]
            });
            at = range.end;
            found.push((range, tag.to_owned()));
        }
        found
    }
}

/// Why a page would grow without end in its frame, if it would: a `vh`
/// unit in its styles, or a height of 100% on its root or body.
pub fn grows(html: &str) -> Option<&'static str> {
    let page = Read::of(html);
    let styles = || {
        page.sheets
            .iter()
            .map(|sheet| (&page.lower[sheet.at.clone()], sheet.on.as_deref()))
    };
    if styles().any(|(css, _)| has_vh(css)) {
        return Some("vh");
    }
    if styles().any(|(css, on)| full_height_on_root(css, on)) {
        return Some("height: 100%");
    }
    None
}

/// A number with `vh`, `dvh`, `svh` or `lvh` after it, as a word of its own.
fn has_vh(css: &str) -> bool {
    let bytes = css.as_bytes();
    css.match_indices("vh").any(|(start, _)| {
        let before = match start.checked_sub(1).map(|i| bytes[i]) {
            Some(b'd' | b's' | b'l') => start - 1,
            _ => start,
        };
        let number = before
            .checked_sub(1)
            .is_some_and(|i| bytes[i].is_ascii_digit() || bytes[i] == b'.');
        let ends = bytes
            .get(start + 2)
            .is_none_or(|next| !next.is_ascii_alphanumeric() && !matches!(next, b'_' | b'-'));
        number && ends
    })
}

/// `height: 100%` (or `min-height`) in `css` that falls on `html`, `body`
/// or `:root`: an element's own style, `on` its tag, or a sheet's rule
/// whose selectors name one.
fn full_height_on_root(css: &str, on: Option<&str>) -> bool {
    let full = |declarations: &str| {
        declarations.match_indices("height").any(|(at, _)| {
            declarations[at + "height".len()..]
                .trim_start()
                .strip_prefix(':')
                .is_some_and(|value| value.trim_start().starts_with("100%"))
        })
    };
    if let Some(tag) = on {
        return (tag == "html" || tag == "body") && full(css);
    }
    let mut selectors = 0;
    css.match_indices(['{', '}']).any(|(at, brace)| {
        if brace == "}" {
            selectors = at + 1;
            return false;
        }
        let names_root = css[selectors..at].split(',').any(|selector| {
            selector
                .split(|c: char| c.is_whitespace() || matches!(c, '>' | '+' | '~'))
                .any(|part| {
                    let name = part.split(['.', '#', '[', ':']).next().unwrap_or_default();
                    name == "html" || name == "body" || part.starts_with(":root")
                })
        });
        let end = css[at..].find('}').map_or(css.len(), |i| at + i);
        selectors = at + 1;
        names_root && full(&css[at + 1..end])
    })
}

/// A local image the page names: its path, and where its address sits.
#[derive(Debug, PartialEq, Eq)]
pub struct Named {
    pub path: String,
    pub at: Range<usize>,
}

/// The local images `html` names by an absolute path or a `file://`
/// address: in `src`, `poster` and `srcset`, and in its styles' `url(…)`.
pub fn named_images(html: &str) -> Vec<Named> {
    let page = Read::of(html);
    let mut named = Vec::new();
    for attribute in ["src", "poster", "srcset"] {
        for (range, _) in page.attributes(attribute) {
            if attribute == "srcset" {
                named.extend(srcset_addresses(html, range).filter_map(|at| local(html, at)));
            } else {
                named.extend(local(html, range));
            }
        }
    }
    for sheet in &page.sheets {
        let css = &page.lower[sheet.at.clone()];
        for (found, _) in css.match_indices("url(") {
            let start = sheet.at.start + found + "url(".len();
            let Some(close) = html[start..sheet.at.end].find(')') else {
                continue;
            };
            let address = trimmed(html, start..start + close);
            let text = &html[address.clone()];
            let quoted = text.len() >= 2
                && (text.starts_with('"') && text.ends_with('"')
                    || text.starts_with('\'') && text.ends_with('\''));
            let address = if quoted {
                address.start + 1..address.end - 1
            } else {
                address
            };
            named.extend(local(html, address));
        }
    }
    named.sort_by_key(|named| named.at.start);
    named
}

/// `range` of `html` without the white space at its ends.
fn trimmed(html: &str, range: Range<usize>) -> Range<usize> {
    let text = &html[range.clone()];
    let start = range.start + (text.len() - text.trim_start().len());
    start..start + text.trim().len()
}

/// The value an attribute's `=` gives at `at`: quoted or bare.
fn value_at(html: &str, at: usize) -> Option<Range<usize>> {
    let start = trimmed(html, at..html.len()).start;
    let quote = html[start..].chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = html[start + 1..].find(quote)?;
        return Some(start + 1..start + 1 + end);
    }
    let end = html[start..]
        .find(|c: char| c.is_whitespace() || c == '>')
        .unwrap_or(html.len() - start);
    Some(start..start + end)
}

/// Where each address of the `srcset` at `range` of `html` sits.
fn srcset_addresses(html: &str, range: Range<usize>) -> impl Iterator<Item = Range<usize>> + '_ {
    let mut at = range.start;
    html[range].split(',').map(move |part| {
        let part_at = at;
        at += part.len() + 1;
        let start = trimmed(html, part_at..part_at + part.len()).start;
        let address = html[start..part_at + part.len()]
            .split_whitespace()
            .next()
            .unwrap_or_default();
        start..start + address.len()
    })
}

/// The local image at `range` of `html`, if the address there is one: an
/// absolute path (not `//host`), or a `file://` address.
fn local(html: &str, range: Range<usize>) -> Option<Named> {
    let address = &html[range.clone()];
    if address.starts_with("//") {
        return None;
    }
    let path = banda_look::path_of(address)?;
    Some(Named {
        path: path.to_string_lossy().into_owned(),
        at: range,
    })
}

/// `html` with each address at a range of `put` replaced by its text.
/// The ranges come in order and do not overlap, as [`named_images`]
/// gives them.
pub fn with_put(html: &str, put: &[(Range<usize>, &str)]) -> String {
    let added: usize = put.iter().map(|(_, text)| text.len()).sum();
    let mut out = String::with_capacity(html.len() + added);
    let mut at = 0;
    for (range, text) in put {
        out.push_str(&html[at..range.start]);
        out.push_str(text);
        at = range.end;
    }
    out.push_str(&html[at..]);
    out
}

/// The kind of image a file is by its first bytes, `head`: PNG, JPEG,
/// GIF, WebP or SVG.
pub fn image_kind(head: &[u8]) -> Option<&'static str> {
    if let Some(kind) = crate::rules::message::image_kind(head) {
        return Some(kind);
    }
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let text = text.trim_start_matches('\u{feff}').trim_start();
    let svg = text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg"));
    svg.then_some("image/svg+xml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_sized_by_its_frame_is_found_in_its_styles() {
        assert_eq!(grows("<style>.a{height:100vh}</style>"), Some("vh"));
        assert_eq!(grows("<div style='min-height: 50.5dvh'>"), Some("vh"));
        assert_eq!(
            grows("<style>p{color:red} html, body { height: 100% }</style>"),
            Some("height: 100%")
        );
        assert_eq!(
            grows("<style>:root{min-height:100%}</style>"),
            Some("height: 100%")
        );
        assert_eq!(grows("<body style=\"height:100%\">"), Some("height: 100%"));
        // Within a box of fixed height, 100% is the box's.
        assert_eq!(
            grows("<style>.chart{height:300px}.chart svg{height:100%}</style>"),
            None
        );
        assert_eq!(grows("<div style=\"height:100%\"></div>"), None);
        assert_eq!(grows("<svg height=\"100%\"></svg>"), None);
        // A page that speaks of it, or a script, is not its styles.
        assert_eq!(
            grows("<p>Use 100vh with care</p><pre>height: 100vh</pre>"),
            None
        );
        assert_eq!(grows("<script>const h = '100vh'</script>"), None);
    }

    #[test]
    fn a_page_names_its_local_images_by_absolute_paths() {
        let html = r#"<img src="/tmp/a.png"><img src='https://x/b.png'>
<video poster=/tmp/c.jpg></video><img srcset="/tmp/d.png 1x, /tmp/e.png 2x">
<div style="background: url( '/tmp/f.webp' )"></div><img src="file:///tmp/g%20h.gif">
<img src="//cdn/x.png"><a href="/tmp/not.png"><img data-src="/tmp/not.png">
<script>fetch(new URL("/api")); img.src = "/tmp/not.png"</script>
<style>.x { background: url(/tmp/i.svg) }</style>"#;
        let named = named_images(html);
        let paths: Vec<_> = named.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "/tmp/a.png",
                "/tmp/c.jpg",
                "/tmp/d.png",
                "/tmp/e.png",
                "/tmp/f.webp",
                "/tmp/g h.gif",
                "/tmp/i.svg"
            ]
        );
        for one in &named {
            let at = &html[one.at.clone()];
            assert!(at == one.path || at.starts_with("file://"), "{at}");
        }
    }

    #[test]
    fn addresses_are_replaced_where_they_sit() {
        let html = r#"<img src="/a.png"> /a.png <img src="/b.png">"#;
        let named = named_images(html);
        let texts: Vec<_> = named.iter().map(|n| format!("[{}]", n.path)).collect();
        let put: Vec<_> = named
            .iter()
            .zip(&texts)
            .map(|(n, text)| (n.at.clone(), text.as_str()))
            .collect();
        assert_eq!(
            with_put(html, &put),
            r#"<img src="[/a.png]"> /a.png <img src="[/b.png]">"#
        );
    }

    #[test]
    fn an_image_is_known_by_its_first_bytes() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(
            image_kind(b"  <svg xmlns='x'></svg>"),
            Some("image/svg+xml")
        );
        assert_eq!(
            image_kind(b"<?xml version='1.0'?><svg/>"),
            Some("image/svg+xml")
        );
        assert_eq!(image_kind(b"SECRET=hunter2"), None);
    }
}
