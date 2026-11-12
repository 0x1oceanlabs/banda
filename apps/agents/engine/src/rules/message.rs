//! What a message may hold: its text, its images, the files it carries
//! and the settings it is sent with, and the Thread's title it gives.

use crate::model::{Image, ImageId, WrittenFrom};
use banda_kernel::{Participant, Refusal, clean_name};
use std::collections::HashSet;

/// How freely an Agent acts is a Person's choice: an Agent sends a message
/// with the settings its Thread has, and changes none.
pub fn may_choose(author: Participant) -> Result<(), Refusal> {
    match author {
        Participant::Person(_) => Ok(()),
        Participant::Agent(_) => Err(Refusal::forbidden(
            "Only a Person chooses how freely an Agent acts.",
        )),
    }
}

/// A Thread's title: the start of its first message, on one line.
pub fn title(text: &str, images: &[Image]) -> String {
    const LONGEST: usize = 60;
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return match images {
            [one] => one.name.clone().unwrap_or_else(|| "An image".to_owned()),
            _ => format!("{} images", images.len()),
        };
    }
    if line.chars().count() <= LONGEST {
        return line;
    }
    let mut short: String = line.chars().take(LONGEST - 1).collect();
    short.push('…');
    short
}

/// The kinds of image a message can carry, as T3 Code takes them, and the
/// first bytes each kind's file starts with.
const IMAGE_KINDS: [(&str, &[u8]); 4] = [
    ("image/png", b"\x89PNG\r\n\x1a\n"),
    ("image/jpeg", b"\xff\xd8\xff"),
    ("image/gif", b"GIF8"),
    ("image/webp", b"RIFF"),
];
pub(crate) const MB: usize = 1024 * 1024;
/// The largest image, the most images and the most of their bytes one
/// message carries, as in T3 Code.
pub(crate) const LARGEST_IMAGE: usize = 10 * MB;
const MOST_IMAGES: usize = 100;
const MOST_IMAGE_BYTES: usize = 80 * MB;

/// The largest file Banda keeps for a message to point at.
const LARGEST_FILE: usize = 20 * MB;

/// The name a file Banda keeps for a message is given, from the name it
/// came with: its last part, its spaces dashes, so `@` reads its path
/// back whole; refused if it is too large, or has no name left.
pub fn kept_name(name: &str, bytes: &[u8]) -> Result<String, Refusal> {
    if bytes.len() > LARGEST_FILE {
        return Err(Refusal::invalid(format!(
            "A file can be at most {} MB.",
            LARGEST_FILE / MB
        )));
    }
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let kept: String = last
        .chars()
        .filter(|c| !c.is_control() && *c != '@')
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .take(120)
        .collect();
    if kept.trim_matches('.').is_empty() {
        return Err(Refusal::invalid("A file needs a name."));
    }
    Ok(kept)
}

/// The kind of image `bytes` are by their first bytes, of those a
/// message can carry.
pub fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    IMAGE_KINDS
        .iter()
        .find(|(kind, starts)| {
            bytes.starts_with(starts)
                && (*kind != "image/webp" || bytes.get(8..12) == Some(b"WEBP"))
        })
        .map(|(kind, _)| *kind)
}

/// Whether `bytes` can go with a message as an image of kind `mime`.
pub fn may_attach(mime: &str, bytes: &[u8]) -> Result<(), Refusal> {
    if !IMAGE_KINDS.iter().any(|(kind, _)| *kind == mime) {
        return Err(Refusal::invalid(
            "A message can carry PNG, JPEG, GIF and WebP images.",
        ));
    }
    if bytes.len() > LARGEST_IMAGE {
        return Err(Refusal::invalid(format!(
            "An image can be at most {} MB.",
            LARGEST_IMAGE / MB
        )));
    }
    if image_kind(bytes) != Some(mime) {
        return Err(Refusal::invalid(format!(
            "This file is not a {mime} image."
        )));
    }
    Ok(())
}

/// Whether a message of `text` can carry the images it names.
pub fn may_send(text: &str, images: &[ImageId]) -> Result<(), Refusal> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(Refusal::invalid("A message needs some text or an image."));
    }
    if images.len() > MOST_IMAGES {
        return Err(Refusal::invalid(format!(
            "A message can carry at most {MOST_IMAGES} images."
        )));
    }
    let named: HashSet<_> = images.iter().collect();
    if named.len() < images.len() {
        return Err(Refusal::invalid("A message carries each image once."));
    }
    Ok(())
}

/// Whether the images a message carries fit in it together.
pub fn may_carry(images: &[Image]) -> Result<(), Refusal> {
    let bytes: usize = images.iter().map(|image| image.size as usize).sum();
    if bytes > MOST_IMAGE_BYTES {
        return Err(Refusal::invalid(format!(
            "A message's images can be at most {} MB together.",
            MOST_IMAGE_BYTES / MB
        )));
    }
    Ok(())
}

/// What becomes of a message's images when `harness` takes none: it gets
/// the text alone, which a notice says; a message of images alone cannot
/// go, which the error says.
pub fn without_images(harness: &str, text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err(format!(
            "{harness} does not take images, and this message holds nothing else."
        ));
    }
    Ok(format!(
        "{harness} does not take images, so it got the text alone."
    ))
}

/// Where a Person's message says it was written from, as the engine keeps
/// it (ADR 0122, decision 2): the machine's name cleaned as a window cleans
/// it; none when nothing is left of it, or an Agent wrote it.
pub fn written_from(author: Participant, from: Option<WrittenFrom>) -> Option<WrittenFrom> {
    if !matches!(author, Participant::Person(_)) {
        return None;
    }
    let WrittenFrom { machine, here } = from?;
    let machine = clean_name(&machine);
    (!machine.is_empty()).then_some(WrittenFrom { machine, here })
}

/// The line the Agent reads before a message written from `now`, when its
/// session was last told of `before` (ADR 0122, decision 3): none when it
/// did not change, and none for the Thread's own machine unless it was
/// told of another. The name is quoted as Rust quotes a string, so a `"`
/// in it is no end of it.
pub fn from_machine(now: Option<&WrittenFrom>, before: Option<&WrittenFrom>, text: &str) -> String {
    let Some(now) = now.filter(|&now| Some(now) != before) else {
        return text.to_owned();
    };
    let machine = &now.machine;
    let said = if !now.here {
        format!(
            "Your Person writes this from their machine {machine:?}, not from this one: \
             a file or path they name is there, not here, and a setting you change here \
             does not change theirs."
        )
    } else if before.is_some_and(|before| !before.here) {
        format!("Your Person writes this from this machine, {machine:?}, again.")
    } else {
        return text.to_owned();
    };
    format!("{said}\n\n{text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_persons_machine_is_kept_clean_and_an_agents_not_at_all() {
        let from = |machine: &str| {
            Some(WrittenFrom {
                machine: machine.to_owned(),
                here: false,
            })
        };
        let person = Participant::Person(banda_kernel::PersonId::new());
        let kept = written_from(
            person,
            from(" Mac\u{202E}Book\u{7} Pro\u{2028} and a long tail "),
        );
        assert_eq!(kept.unwrap().machine, "MacBook Pro and");
        assert_eq!(written_from(person, from("\u{200B} ")), None);
        let agent = Participant::Agent(banda_kernel::AgentId::new());
        assert_eq!(written_from(agent, from("arc")), None);
    }

    #[test]
    fn the_line_goes_only_when_the_machine_changed() {
        let mac = WrittenFrom {
            machine: "Mac".into(),
            here: false,
        };
        let arc = WrittenFrom {
            machine: "arc".into(),
            here: true,
        };
        let line = |now, before| from_machine(now, before, "hi");
        assert!(
            line(Some(&mac), None)
                .starts_with("Your Person writes this from their machine \"Mac\"")
        );
        assert!(line(Some(&mac), Some(&arc)).ends_with("\n\nhi"));
        assert_eq!(line(Some(&mac), Some(&mac)), "hi");
        assert_eq!(line(Some(&arc), None), "hi");
        assert_eq!(line(None, Some(&mac)), "hi");
        assert_eq!(
            line(Some(&arc), Some(&mac)),
            "Your Person writes this from this machine, \"arc\", again.\n\nhi"
        );
    }

    #[test]
    fn a_kept_file_is_named_so_its_path_reads_back_whole() {
        let name = |name: &str| kept_name(name, b"x");
        assert_eq!(name("notes.md").unwrap(), "notes.md");
        assert_eq!(name("/home/me/My Notes.txt").unwrap(), "My-Notes.txt");
        assert_eq!(name("C:\\work\\a@b.rs").unwrap(), "ab.rs");
        assert!(name("..").is_err());
        assert!(name("dir/").is_err());
        let large = vec![0; LARGEST_FILE + 1];
        assert!(kept_name("big.bin", &large).is_err());
    }

    #[test]
    fn a_title_is_one_short_line() {
        assert_eq!(title("  Fix\nthe   report ", &[]), "Fix the report");
        let long = title(&"word ".repeat(30), &[]);
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_message_of_images_alone_is_named_after_them() {
        let image = |name: Option<&str>| Image {
            id: ImageId::new(),
            mime: "image/png".to_owned(),
            size: 1,
            name: name.map(str::to_owned),
        };
        assert_eq!(title(" ", &[image(Some("shot.png"))]), "shot.png");
        assert_eq!(title("", &[image(None)]), "An image");
        assert_eq!(title("", &[image(None), image(None)]), "2 images");
        assert_eq!(title("Look", &[image(None)]), "Look");
    }

    #[test]
    fn an_image_is_one_of_four_kinds_its_bytes_bear_out() {
        let png = b"\x89PNG\r\n\x1a\n....";
        assert_eq!(may_attach("image/png", png), Ok(()));
        assert_eq!(may_attach("image/jpeg", b"\xff\xd8\xff\xe0"), Ok(()));
        assert_eq!(may_attach("image/gif", b"GIF89a"), Ok(()));
        assert_eq!(may_attach("image/webp", b"RIFF\0\0\0\0WEBPVP8 "), Ok(()));
        assert!(may_attach("image/webp", b"RIFF\0\0\0\0WAVEfmt ").is_err());
        assert!(may_attach("image/jpeg", png).is_err(), "a PNG named a JPEG");
        assert!(may_attach("image/svg+xml", b"<svg/>").is_err());
        let large = [png.as_slice(), &vec![0; LARGEST_IMAGE]].concat();
        assert_eq!(
            may_attach("image/png", &large).unwrap_err().message,
            "An image can be at most 10 MB."
        );
    }

    #[test]
    fn a_message_carries_some_text_or_images_each_once_and_not_too_many() {
        let one = ImageId::new();
        assert!(may_send(" ", &[]).is_err());
        assert_eq!(may_send("", &[one]), Ok(()));
        assert!(may_send("look", &[one, one]).is_err());
        let many: Vec<_> = (0..=MOST_IMAGES).map(|_| ImageId::new()).collect();
        assert!(may_send("look", &many).is_err());
        assert_eq!(may_send("look", &many[1..]), Ok(()));

        let image = |size| Image {
            id: ImageId::new(),
            mime: "image/png".to_owned(),
            size,
            name: None,
        };
        let full = (LARGEST_IMAGE as u32, MOST_IMAGE_BYTES as u32);
        assert_eq!(may_carry(&vec![image(full.0); 8]), Ok(()));
        assert!(may_carry(&[vec![image(full.0); 8], vec![image(1)]].concat()).is_err());
        assert_eq!(may_carry(&[image(full.1)]), Ok(()));
    }
}
